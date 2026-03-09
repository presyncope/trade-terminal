"""
Binance historical kline fetcher — powered by NautilusTrader.

Uses nautilus_trader's Binance HTTP adapter instead of raw aiohttp, giving us:
  - Built-in rate-limit handling (429/418 back-off)
  - Typed response objects via msgspec
  - Consistent spot / futures abstraction
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import AsyncIterator

from nautilus_trader.adapters.binance.common.enums import BinanceAccountType, BinanceKlineInterval
from nautilus_trader.adapters.binance.futures.http.market import BinanceFuturesMarketHttpAPI
from nautilus_trader.adapters.binance.http.client import BinanceHttpClient
from nautilus_trader.adapters.binance.spot.http.market import BinanceSpotMarketHttpAPI
from nautilus_trader.common.component import LiveClock

logger = logging.getLogger("data-worker.binance")

# REST base URLs
SPOT_URL            = "https://api.binance.com"
SPOT_TESTNET_URL    = "https://testnet.binance.vision"
FUTURES_URL         = "https://fapi.binance.com"
FUTURES_TESTNET_URL = "https://testnet.binancefuture.com"

MAX_LIMIT = 1000  # Binance max candles per request

# Interval string → BinanceKlineInterval enum
INTERVAL_MAP: dict[str, BinanceKlineInterval] = {
    "1m":  BinanceKlineInterval.MINUTE_1,
    "5m":  BinanceKlineInterval.MINUTE_5,
    "15m": BinanceKlineInterval.MINUTE_15,
    "1h":  BinanceKlineInterval.HOUR_1,
    "4h":  BinanceKlineInterval.HOUR_4,
    "1d":  BinanceKlineInterval.DAY_1,
}

# Interval string → milliseconds per candle (for pagination cursor)
INTERVAL_MS: dict[str, int] = {
    "1m":  60_000,
    "5m":  300_000,
    "15m": 900_000,
    "1h":  3_600_000,
    "4h":  14_400_000,
    "1d":  86_400_000,
}


class BinanceFetcher:
    """
    Fetches historical klines from Binance spot or futures via the
    nautilus_trader Binance HTTP adapter.

    The NT adapter transparently handles:
      - X-MBX-APIKEY / HMAC-SHA256 authentication
      - Rate-limit back-off (HTTP 429 / 418)
      - Spot vs futures endpoint differences

    Usage::

        async with BinanceFetcher(api_key=..., futures=False) as fetcher:
            async for batch in fetcher.fetch_klines("BTCUSDT", "1m", start, end):
                await bulk_insert_klines(pool, exchange, symbol, batch)
    """

    def __init__(
        self,
        api_key: str = "",
        api_secret: str = "",
        testnet: bool = True,
        futures: bool = False,
    ):
        if futures:
            base_url    = FUTURES_TESTNET_URL if testnet else FUTURES_URL
            account_type = BinanceAccountType.USDT_FUTURE
        else:
            base_url    = SPOT_TESTNET_URL if testnet else SPOT_URL
            account_type = BinanceAccountType.SPOT

        self._http = BinanceHttpClient(
            clock=LiveClock(),
            api_key=api_key,
            api_secret=api_secret,
            base_url=base_url,
        )

        if futures:
            self._market = BinanceFuturesMarketHttpAPI(
                client=self._http,
                account_type=account_type,
            )
        else:
            self._market = BinanceSpotMarketHttpAPI(
                client=self._http,
                account_type=account_type,
            )

    # ── Async context manager ─────────────────────────────────
    async def __aenter__(self) -> BinanceFetcher:
        return self

    async def __aexit__(self, *_) -> None:
        pass  # BinanceHttpClient manages its own lifecycle in nautilus_trader >= 1.220

    # ── Main API ──────────────────────────────────────────────
    async def fetch_klines(
        self,
        symbol: str,
        interval: str = "1m",
        start: datetime | None = None,
        end: datetime | None = None,
        batch_size: int = 1000,
    ) -> AsyncIterator[list[tuple]]:
        """
        Yields batches of kline tuples compatible with bulk_insert_klines:
            (ts, open, high, low, close, volume, turnover, trade_count)

        Handles Binance pagination automatically via cursor advance.
        """
        nt_interval  = INTERVAL_MAP.get(interval, BinanceKlineInterval.MINUTE_1)
        interval_ms  = INTERVAL_MS.get(interval, 60_000)
        current_start = int(start.timestamp() * 1000) if start else None
        end_ms        = int(end.timestamp() * 1000)   if end   else None

        while True:
            # NT adapter returns list[BinanceKline] (msgspec.Struct)
            # Fields: open_time, open, high, low, close, volume,
            #         close_time, quote_volume, count,
            #         taker_buy_base_volume, taker_buy_quote_volume, ignore
            klines = await self._market.query_klines(
                symbol=symbol,
                interval=nt_interval,
                start_time=current_start,
                end_time=end_ms,
                limit=MAX_LIMIT,
            )

            if not klines:
                break

            batch = [
                (
                    datetime.fromtimestamp(k.open_time / 1000, tz=timezone.utc),
                    float(k.open),
                    float(k.high),
                    float(k.low),
                    float(k.close),
                    float(k.volume),
                    float(k.asset_volume),  # turnover = quote asset volume
                    int(k.trades_count),    # trade_count
                )
                for k in klines
            ]

            yield batch

            if len(klines) < MAX_LIMIT:
                break  # no more pages

            # Advance cursor: open_time of last candle + 1 interval
            current_start = klines[-1].open_time + interval_ms

            logger.debug(
                f"Fetched {len(klines)} klines, "
                f"next start={datetime.fromtimestamp(current_start / 1000, tz=timezone.utc)}"
            )
