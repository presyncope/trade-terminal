"""
Order Executor — Binance Spot live order submission.

Supported order types (Binance Spot):
  MARKET            — execute immediately at best available price
  LIMIT             — rest on book at specified price (GTC / IOC / FOK)
  LIMIT_MAKER       — limit order providing liquidity only (post-only)
  STOP_LIMIT        — triggers at stop_price, executes as limit at price
  TAKE_PROFIT_LIMIT — triggers at stop_price, executes as limit at price
  OCO               — linked limit (TP) + stop-limit (SL), one cancels other

Payload keys per type:
  All types:   exchange, symbol, side, type, quantity
  LIMIT:       + price, time_in_force (GTC|IOC|FOK, default GTC)
  LIMIT_MAKER: + price
  STOP_LIMIT / TAKE_PROFIT_LIMIT:
               + price (limit execution price)
               + stop_price (trigger price)
               + time_in_force (default GTC)
  OCO:         + price (limit/TP price)
               + stop_price (SL trigger)
               + stop_limit_price (SL limit execution price)
               + time_in_force (default GTC)

Cancel payload:
  exchange, symbol, order_id
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import time
from datetime import datetime, timezone
from urllib.parse import urlencode

import aiohttp

from services.shared.config import BinanceConfig

logger = logging.getLogger("trading.executor")

SPOT_URL            = "https://api.binance.com"
SPOT_TESTNET_URL    = "https://testnet.binance.vision"
FUTURES_URL         = "https://fapi.binance.com"
FUTURES_TESTNET_URL = "https://testnet.binancefuture.com"


class OrderExecutor:
    """Submits and cancels orders on supported exchanges."""

    def __init__(self):
        self._session: aiohttp.ClientSession | None = None
        self._cfg = BinanceConfig()
        self._spot_base    = SPOT_TESTNET_URL    if self._cfg.testnet else SPOT_URL
        self._futures_base = FUTURES_TESTNET_URL if self._cfg.testnet else FUTURES_URL

    async def initialize(self):
        self._session = aiohttp.ClientSession()

    async def shutdown(self):
        if self._session:
            await self._session.close()

    # ── Public API ─────────────────────────────────────────────────────────────

    async def submit_order(self, cmd: dict) -> dict | None:
        exchange = cmd.get("exchange", "")
        if exchange == "binance_spot":
            return await self._submit_spot(cmd)
        if exchange == "binance_futures":
            return await self._submit_futures(cmd)
        logger.error(f"Unsupported exchange: {exchange}")
        return None

    async def cancel_order(self, cmd: dict) -> dict | None:
        exchange = cmd.get("exchange", "")
        if exchange == "binance_spot":
            return await self._cancel_spot(cmd)
        if exchange == "binance_futures":
            return await self._cancel_futures(cmd)
        logger.warning(f"Cancel not implemented for: {exchange}")
        return None

    # ── Binance Spot ────────────────────────────────────────────────────────────

    async def _submit_spot(self, cmd: dict) -> dict | None:
        order_type = cmd.get("type", "MARKET").upper()

        if order_type == "OCO":
            return await self._submit_spot_oco(cmd)

        params: dict = {
            "symbol":    cmd["symbol"],
            "side":      cmd["side"].upper(),
            "type":      order_type,
            "quantity":  _fmt(cmd["quantity"]),
            "timestamp": _ts(),
            "recvWindow": "5000",
        }

        if order_type == "LIMIT":
            params["price"]       = _fmt(cmd["price"])
            params["timeInForce"] = cmd.get("time_in_force", "GTC")

        elif order_type == "LIMIT_MAKER":
            params["price"] = _fmt(cmd["price"])
            # No timeInForce — LIMIT_MAKER always provides liquidity

        elif order_type in ("STOP_LOSS_LIMIT", "TAKE_PROFIT_LIMIT"):
            params["price"]       = _fmt(cmd["price"])       # limit execution price
            params["stopPrice"]   = _fmt(cmd["stop_price"])  # trigger price
            params["timeInForce"] = cmd.get("time_in_force", "GTC")

        # MARKET requires no extra params

        data = await self._signed_post("/api/v3/order", params)
        if data is None:
            return None
        return _build_fill(cmd, data)

    async def _submit_spot_oco(self, cmd: dict) -> dict | None:
        """
        OCO — One-Cancels-Other:
          Creates a LIMIT order (take-profit) + STOP_LOSS_LIMIT order (stop-loss)
          simultaneously. When one fills, the other is cancelled automatically.

        Required fields: price, stop_price, stop_limit_price
        """
        params: dict = {
            "symbol":                cmd["symbol"],
            "side":                  cmd["side"].upper(),
            "quantity":              _fmt(cmd["quantity"]),
            "price":                 _fmt(cmd["price"]),             # TP limit price
            "stopPrice":             _fmt(cmd["stop_price"]),        # SL trigger
            "stopLimitPrice":        _fmt(cmd["stop_limit_price"]),  # SL limit price
            "stopLimitTimeInForce":  cmd.get("time_in_force", "GTC"),
            "timestamp":             _ts(),
            "recvWindow":            "5000",
        }

        data = await self._signed_post("/api/v3/order/oco", params)
        if data is None:
            return None

        # OCO response: {orderListId, orders: [{orderId, ...}, ...]}
        orders = data.get("orders", [{}])
        return {
            "ts":       datetime.now(timezone.utc).isoformat(),
            "exchange": cmd["exchange"],
            "symbol":   cmd["symbol"],
            "side":     cmd["side"].upper(),
            "price":    float(cmd["price"]),
            "quantity": float(cmd["quantity"]),
            "order_id": str(orders[0].get("orderId", "")) if orders else "",
            "status":   "OCO_SUBMITTED",
            "is_manual": True,
        }

    async def _cancel_spot(self, cmd: dict) -> dict | None:
        params: dict = {
            "symbol":    cmd["symbol"],
            "orderId":   str(cmd["order_id"]),
            "timestamp": _ts(),
            "recvWindow": "5000",
        }
        data = await self._signed_delete("/api/v3/order", params, base=self._spot_base)
        if data:
            logger.info(f"Cancelled spot order {cmd['order_id']} for {cmd['symbol']}")
        return data

    # ── Binance Futures (MARKET + LIMIT only) ───────────────────────────────────

    async def _submit_futures(self, cmd: dict) -> dict | None:
        order_type = cmd.get("type", "MARKET").upper()
        params: dict = {
            "symbol":    cmd["symbol"],
            "side":      cmd["side"].upper(),
            "type":      order_type,
            "quantity":  _fmt(cmd["quantity"]),
            "timestamp": _ts(),
            "recvWindow": "5000",
        }
        if order_type == "LIMIT":
            params["price"]       = _fmt(cmd["price"])
            params["timeInForce"] = cmd.get("time_in_force", "GTC")

        data = await self._signed_post("/fapi/v1/order", params, base=self._futures_base)
        if data is None:
            return None
        return _build_fill(cmd, data)

    async def _cancel_futures(self, cmd: dict) -> dict | None:
        params: dict = {
            "symbol":    cmd["symbol"],
            "orderId":   str(cmd["order_id"]),
            "timestamp": _ts(),
            "recvWindow": "5000",
        }
        data = await self._signed_delete("/fapi/v1/order", params, base=self._futures_base)
        if data:
            logger.info(f"Cancelled futures order {cmd['order_id']} for {cmd['symbol']}")
        return data

    # ── HTTP helpers ────────────────────────────────────────────────────────────

    async def _signed_post(
        self, endpoint: str, params: dict, base: str | None = None
    ) -> dict | None:
        url = f"{base or self._spot_base}{endpoint}"
        params = self._sign(params)
        headers = {"X-MBX-APIKEY": self._cfg.api_key}
        try:
            async with self._session.post(url, params=params, headers=headers) as resp:
                data = await resp.json()
                if resp.status != 200:
                    logger.error(f"Binance POST {endpoint} {resp.status}: {data}")
                    return None
                return data
        except Exception:
            logger.exception(f"POST {endpoint} failed")
            return None

    async def _signed_delete(
        self, endpoint: str, params: dict, base: str | None = None
    ) -> dict | None:
        url = f"{base or self._spot_base}{endpoint}"
        params = self._sign(params)
        headers = {"X-MBX-APIKEY": self._cfg.api_key}
        try:
            async with self._session.delete(url, params=params, headers=headers) as resp:
                data = await resp.json()
                if resp.status != 200:
                    logger.error(f"Binance DELETE {endpoint} {resp.status}: {data}")
                    return None
                return data
        except Exception:
            logger.exception(f"DELETE {endpoint} failed")
            return None

    def _sign(self, params: dict) -> dict:
        qs = urlencode(params)
        sig = hmac.new(
            self._cfg.api_secret.encode(),
            qs.encode(),
            hashlib.sha256,
        ).hexdigest()
        return {**params, "signature": sig}


# ── Helpers ─────────────────────────────────────────────────────────────────

def _ts() -> str:
    return str(int(time.time() * 1000))


def _fmt(v) -> str:
    """Format a number for Binance (no scientific notation)."""
    return f"{float(v):.10f}".rstrip("0").rstrip(".")


def _build_fill(cmd: dict, data: dict) -> dict:
    return {
        "ts":       datetime.now(timezone.utc).isoformat(),
        "exchange": cmd["exchange"],
        "symbol":   cmd["symbol"],
        "side":     cmd["side"].upper(),
        "price":    float(data.get("avgPrice") or data.get("price") or 0),
        "quantity": float(data.get("executedQty") or cmd["quantity"]),
        "order_id": str(data.get("orderId", "")),
        "status":   data.get("status", "SUBMITTED"),
        "is_manual": True,
    }
