"""
Binance historical kline fetcher.

Uses the Binance REST API to fetch historical candlestick data.
Implements pagination with rate-limit awareness.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import AsyncIterator

import aiohttp

logger = logging.getLogger("data-worker.binance")

# Binance kline REST endpoints
SPOT_URL = "https://api.binance.com/api/v3/klines"
SPOT_TESTNET_URL = "https://testnet.binance.vision/api/v3/klines"
FUTURES_URL = "https://fapi.binance.com/fapi/v1/klines"
FUTURES_TESTNET_URL = "https://testnet.binancefuture.com/fapi/v1/klines"

MAX_LIMIT = 1000  # Binance max per request


class BinanceFetcher:
    """Fetches historical klines from Binance spot or futures."""

    def __init__(
        self,
        api_key: str = "",
        api_secret: str = "",
        testnet: bool = True,
        futures: bool = False,
    ):
        self.api_key = api_key
        self.futures = futures

        if futures:
            self.base_url = FUTURES_TESTNET_URL if testnet else FUTURES_URL
        else:
            self.base_url = SPOT_TESTNET_URL if testnet else SPOT_URL

    async def fetch_klines(
        self,
        symbol: str,
        interval: str = "1m",
        start: datetime | None = None,
        end: datetime | None = None,
        batch_size: int = 1000,
    ) -> AsyncIterator[list[tuple]]:
        """
        Yields batches of kline tuples:
            (timestamp, open, high, low, close, volume, turnover, trade_count)

        Handles Binance pagination automatically.
        """
        start_ms = int(start.timestamp() * 1000) if start else None
        end_ms = int(end.timestamp() * 1000) if end else None

        headers = {}
        if self.api_key:
            headers["X-MBX-APIKEY"] = self.api_key

        async with aiohttp.ClientSession(headers=headers) as session:
            current_start = start_ms

            while True:
                params: dict = {
                    "symbol": symbol,
                    "interval": interval,
                    "limit": MAX_LIMIT,
                }
                if current_start is not None:
                    params["startTime"] = current_start
                if end_ms is not None:
                    params["endTime"] = end_ms

                async with session.get(self.base_url, params=params) as resp:
                    if resp.status == 429:
                        # Rate limited — back off
                        retry_after = int(resp.headers.get("Retry-After", "60"))
                        logger.warning(f"Rate limited, sleeping {retry_after}s")
                        await asyncio.sleep(retry_after)
                        continue

                    resp.raise_for_status()
                    raw = await resp.json()

                if not raw:
                    break

                batch = []
                for k in raw:
                    # Binance kline format:
                    # [open_time, open, high, low, close, volume,
                    #  close_time, quote_volume, trades, ...]
                    ts = datetime.fromtimestamp(k[0] / 1000, tz=timezone.utc)
                    batch.append((
                        ts,                     # ts
                        float(k[1]),            # open
                        float(k[2]),            # high
                        float(k[3]),            # low
                        float(k[4]),            # close
                        float(k[5]),            # volume
                        float(k[7]),            # turnover (quote volume)
                        int(k[8]),              # trade_count
                    ))

                yield batch

                # Advance cursor past last candle
                last_open_ms = raw[-1][0]
                if len(raw) < MAX_LIMIT:
                    break  # No more data
                current_start = last_open_ms + 60_000  # next minute

                # Respect rate limits
                await asyncio.sleep(0.1)
