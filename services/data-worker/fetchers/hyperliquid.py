"""
Hyperliquid historical kline fetcher — stub.

TODO: Implement using Hyperliquid's info API:
  POST https://api.hyperliquid.xyz/info
  {"type": "candleSnapshot", "req": {"coin": "BTC", "interval": "1m", "startTime": ..., "endTime": ...}}
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import AsyncIterator

logger = logging.getLogger("data-worker.hyperliquid")


class HyperliquidFetcher:
    """Fetches historical klines from Hyperliquid futures."""

    def __init__(self, api_key: str = "", api_secret: str = ""):
        self.api_key = api_key
        self.api_secret = api_secret
        self.base_url = "https://api.hyperliquid.xyz/info"

    async def fetch_klines(
        self,
        symbol: str,
        interval: str = "1m",
        start: datetime | None = None,
        end: datetime | None = None,
        batch_size: int = 1000,
    ) -> AsyncIterator[list[tuple]]:
        """Yields batches of kline tuples. TODO: implement."""
        raise NotImplementedError("Hyperliquid fetcher not yet implemented")
        yield  # make it an async generator
