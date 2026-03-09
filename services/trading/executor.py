"""
Order Executor — Exchange order submission abstraction.

Skeleton implementation that will be replaced with
NautilusTrader's execution engine in the full version.
For now, it talks directly to exchange REST APIs.
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


class OrderExecutor:
    """Submits orders to exchanges and returns fill information."""

    def __init__(self):
        self._session: aiohttp.ClientSession | None = None
        self._binance_cfg = BinanceConfig()

    async def initialize(self):
        self._session = aiohttp.ClientSession()

    async def shutdown(self):
        if self._session:
            await self._session.close()

    async def submit_order(self, cmd: dict) -> dict | None:
        """
        Submit an order to the appropriate exchange.

        Returns a fill dict on success, None on failure.
        """
        exchange = cmd["exchange"]

        if exchange.startswith("binance"):
            return await self._submit_binance(cmd)
        elif exchange == "hyperliquid":
            return await self._submit_hyperliquid(cmd)
        else:
            logger.error(f"Unsupported exchange: {exchange}")
            return None

    async def cancel_order(self, cmd: dict):
        """Cancel an open order."""
        logger.info(f"Cancel order: {cmd}")
        # TODO: implement per-exchange cancellation

    # ─── Binance ──────────────────────────────────────────
    async def _submit_binance(self, cmd: dict) -> dict | None:
        futures = "futures" in cmd["exchange"]

        if self._binance_cfg.testnet:
            base = "https://testnet.binancefuture.com" if futures else "https://testnet.binance.vision"
        else:
            base = "https://fapi.binance.com" if futures else "https://api.binance.com"

        endpoint = "/fapi/v1/order" if futures else "/api/v3/order"

        params: dict = {
            "symbol": cmd["symbol"],
            "side": cmd["side"].upper(),
            "type": cmd.get("type", "MARKET").upper(),
            "quantity": str(cmd["quantity"]),
            "timestamp": str(int(time.time() * 1000)),
            "recvWindow": "5000",
        }

        if params["type"] == "LIMIT":
            params["price"] = str(cmd["price"])
            params["timeInForce"] = cmd.get("time_in_force", "GTC")

        # Sign request
        query_string = urlencode(params)
        signature = hmac.new(
            self._binance_cfg.api_secret.encode(),
            query_string.encode(),
            hashlib.sha256,
        ).hexdigest()
        params["signature"] = signature

        headers = {"X-MBX-APIKEY": self._binance_cfg.api_key}

        try:
            async with self._session.post(
                f"{base}{endpoint}", params=params, headers=headers,
            ) as resp:
                data = await resp.json()
                if resp.status != 200:
                    logger.error(f"Binance order error: {data}")
                    return None

                # Build fill from response
                return {
                    "ts": datetime.now(timezone.utc).isoformat(),
                    "exchange": cmd["exchange"],
                    "symbol": cmd["symbol"],
                    "side": cmd["side"].upper(),
                    "price": float(data.get("avgPrice", data.get("price", 0))),
                    "quantity": float(data.get("executedQty", cmd["quantity"])),
                    "order_id": str(data.get("orderId", "")),
                    "status": data.get("status", "FILLED"),
                    "is_manual": True,
                }
        except Exception:
            logger.exception("Binance order submission failed")
            return None

    # ─── Hyperliquid ──────────────────────────────────────
    async def _submit_hyperliquid(self, cmd: dict) -> dict | None:
        """TODO: Implement Hyperliquid order submission."""
        logger.warning("Hyperliquid order execution not yet implemented")
        return None
