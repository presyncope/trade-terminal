"""
Binance REST API client (read-only) for Web API.

Used to query account state without going through the Trading Node:
  - GET /api/v3/openOrders  — open/active spot orders
  - GET /api/v3/account     — spot account balances
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import time
from urllib.parse import urlencode

import aiohttp

import sys
sys.path.insert(0, "/app")
from services.shared.config import BinanceConfig

logger = logging.getLogger("web-api.binance")

SPOT_URL         = "https://api.binance.com"
SPOT_TESTNET_URL = "https://testnet.binance.vision"


class BinanceAccountClient:
    """Read-only Binance Spot REST client: open orders and account balances."""

    def __init__(self):
        self._cfg  = BinanceConfig()
        self._base = SPOT_TESTNET_URL if self._cfg.testnet else SPOT_URL
        self._session: aiohttp.ClientSession | None = None

    async def initialize(self):
        self._session = aiohttp.ClientSession()

    async def close(self):
        if self._session:
            await self._session.close()

    async def get_open_orders(self, symbol: str | None = None) -> list:
        """Return all open orders for a symbol (or all symbols if None)."""
        params: dict = {"timestamp": _ts(), "recvWindow": "5000"}
        if symbol:
            params["symbol"] = symbol
        result = await self._signed_get("/api/v3/openOrders", params)
        return result if isinstance(result, list) else []

    async def get_account_balances(self) -> list:
        """Return non-zero asset balances from the spot account."""
        params: dict = {"timestamp": _ts(), "recvWindow": "5000"}
        result = await self._signed_get("/api/v3/account", params)
        if not isinstance(result, dict):
            return []
        return [
            b for b in result.get("balances", [])
            if float(b["free"]) > 0 or float(b["locked"]) > 0
        ]

    # ── Internal ─────────────────────────────────────────────────────────────

    async def _signed_get(self, endpoint: str, params: dict) -> dict | list | None:
        qs  = urlencode(params)
        sig = hmac.new(
            self._cfg.api_secret.encode(),
            qs.encode(),
            hashlib.sha256,
        ).hexdigest()
        final_params = {**params, "signature": sig}
        headers = {"X-MBX-APIKEY": self._cfg.api_key}
        url = f"{self._base}{endpoint}"
        try:
            async with self._session.get(url, params=final_params, headers=headers) as resp:
                data = await resp.json()
                if resp.status != 200:
                    logger.error(f"Binance GET {endpoint} {resp.status}: {data}")
                    return None
                return data
        except Exception:
            logger.exception(f"GET {endpoint} failed")
            return None


def _ts() -> str:
    return str(int(time.time() * 1000))
