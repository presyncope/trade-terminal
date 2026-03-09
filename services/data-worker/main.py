"""
Data Worker — Historical kline fetcher & TimescaleDB bulk inserter.

Fetches historical 1-minute candles from exchanges and bulk-inserts
them into TimescaleDB. Can be triggered by:
  1. CLI arguments (backfill mode)
  2. Redis command subscription (on-demand from web-api)
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
from datetime import datetime, timezone

import asyncpg
import redis.asyncio as aioredis

sys.path.insert(0, "/app")
from services.shared.config import TimescaleConfig, RedisConfig, BinanceConfig, Channels
from services.shared.db import create_pool
from services.shared.redis_client import create_redis
from services.data_worker.fetchers.binance import BinanceFetcher

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")
logger = logging.getLogger("data-worker")


# ─── Bulk Insert ──────────────────────────────────────────
async def bulk_insert_klines(
    pool: asyncpg.Pool,
    exchange: str,
    symbol: str,
    rows: list[tuple],
) -> int:
    """Insert 1m kline rows into the klines hypertable.
    Each row: (ts, open, high, low, close, volume, turnover, trade_count)
    """
    if not rows:
        return 0

    async with pool.acquire() as conn:
        await conn.executemany(
            """
            INSERT INTO klines (ts, exchange, symbol, open, high, low, close, volume, turnover, trade_count)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (exchange, symbol, ts) DO NOTHING
            """,
            [(row[0], exchange, symbol, *row[1:]) for row in rows],
        )
        return len(rows)


async def bulk_insert_klines_native(
    pool: asyncpg.Pool,
    exchange: str,
    symbol: str,
    interval: str,
    rows: list[tuple],
) -> int:
    """Insert higher-timeframe klines (5m/15m/1h/4h/1d) into klines_native.
    Each row: (ts, open, high, low, close, volume, ...)  — only first 6 fields used.
    """
    if not rows:
        return 0

    async with pool.acquire() as conn:
        await conn.executemany(
            """
            INSERT INTO klines_native (ts, exchange, symbol, interval, open, high, low, close, volume)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (exchange, symbol, interval, ts) DO NOTHING
            """,
            [(row[0], exchange, symbol, interval, row[1], row[2], row[3], row[4], row[5])
             for row in rows],
        )
        return len(rows)


# ─── Backfill Logic ───────────────────────────────────────
async def backfill(
    pool: asyncpg.Pool,
    exchange: str,
    symbol: str,
    start: datetime,
    end: datetime,
    interval: str = "1m",
    batch_size: int = 1000,
    redis=None,
):
    """Fetch historical klines and insert in batches.

    interval="1m"  → stored in klines (base hypertable, used for time_bucket aggregation)
    interval=other → stored in klines_native (pre-aggregated at native resolution)
    """
    logger.info(f"Backfilling {exchange}:{symbol} [{interval}] from {start} to {end}")

    total = 0
    async with _get_fetcher(exchange) as fetcher:
        async for batch in fetcher.fetch_klines(
            symbol=symbol,
            interval=interval,
            start=start,
            end=end,
            batch_size=batch_size,
        ):
            if interval == "1m":
                count = await bulk_insert_klines(pool, exchange, symbol, batch)
            else:
                count = await bulk_insert_klines_native(pool, exchange, symbol, interval, batch)
            total += count
            logger.info(f"  Inserted {count} rows (total: {total})")

    logger.info(f"Backfill complete: {total} rows for {exchange}:{symbol}")

    if redis:
        channel = f"backfill:done:{exchange}:{symbol}"
        await redis.publish(channel, json.dumps({
            "exchange": exchange,
            "symbol": symbol,
            "start": start.isoformat(),
            "end": end.isoformat(),
        }))
        logger.info(f"Published completion to {channel}")

    return total


def _get_fetcher(exchange: str):
    """Factory for exchange-specific fetchers."""
    if exchange.startswith("binance"):
        cfg = BinanceConfig()
        return BinanceFetcher(
            api_key=cfg.api_key,
            api_secret=cfg.api_secret,
            testnet=cfg.testnet,
            futures=("futures" in exchange),
        )
    # TODO: HyperliquidFetcher
    raise ValueError(f"Unsupported exchange: {exchange}")


# ─── Redis Command Listener (on-demand fetch) ────────────
CMD_BACKFILL = "cmd:backfill"


async def listen_commands(pool: asyncpg.Pool, redis: aioredis.Redis):
    """Listen for backfill commands from web-api."""
    pubsub = redis.pubsub()
    await pubsub.subscribe(CMD_BACKFILL)
    logger.info(f"Listening for commands on '{CMD_BACKFILL}'")

    async for msg in pubsub.listen():
        if msg["type"] != "message":
            continue
        try:
            payload = json.loads(msg["data"])
            # Expected: {"exchange": "binance_spot", "symbol": "BTCUSDT",
            #            "interval": "1h",  (optional, defaults to "1m")
            #            "start": "2024-01-01T00:00:00Z", "end": "2024-06-01T00:00:00Z"}
            await backfill(
                pool=pool,
                exchange=payload["exchange"],
                symbol=payload["symbol"],
                interval=payload.get("interval", "1m"),
                start=datetime.fromisoformat(payload["start"]),
                end=datetime.fromisoformat(payload["end"]),
                redis=redis,
            )
        except Exception:
            logger.exception("Error processing backfill command")


# ─── Entry Point ──────────────────────────────────────────
async def main():
    pool = await create_pool()
    rds = create_redis()

    try:
        if len(sys.argv) > 1 and sys.argv[1] == "backfill":
            # CLI mode: python main.py backfill binance_spot BTCUSDT 2024-01-01 2024-06-01
            exchange = sys.argv[2]
            symbol = sys.argv[3]
            start = datetime.fromisoformat(sys.argv[4]).replace(tzinfo=timezone.utc)
            end = datetime.fromisoformat(sys.argv[5]).replace(tzinfo=timezone.utc)
            await backfill(pool, exchange, symbol, start, end, redis=rds)
        else:
            # Daemon mode: listen for commands
            await listen_commands(pool, rds)
    finally:
        await pool.close()
        await rds.close()


if __name__ == "__main__":
    asyncio.run(main())
