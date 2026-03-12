"""TimescaleDB kline rows → NautilusTrader Bar objects."""

from __future__ import annotations

from datetime import datetime

import asyncpg
from nautilus_trader.core.datetime import dt_to_unix_nanos
from nautilus_trader.model.data import Bar, BarSpecification, BarType
from nautilus_trader.model.enums import AggregationSource, BarAggregation, PriceType
from nautilus_trader.model.identifiers import InstrumentId, Venue
from nautilus_trader.model.objects import Price, Quantity

VENUE_MAP: dict[str, str] = {
    "binance_spot":    "BINANCE",
    "binance_futures": "BINANCE",
    "hyperliquid":     "HYPERLIQUID",
}


def _make_bar_type(exchange: str, symbol: str) -> BarType:
    venue_str = VENUE_MAP.get(exchange, exchange.upper())
    instrument_id = InstrumentId.from_str(f"{symbol}.{venue_str}")
    spec = BarSpecification(
        step=1,
        aggregation=BarAggregation.MINUTE,
        price_type=PriceType.LAST,
    )
    return BarType(
        instrument_id=instrument_id,
        spec=spec,
        aggregation_source=AggregationSource.EXTERNAL,
    )


def _row_to_bar(row: asyncpg.Record, bar_type: BarType) -> Bar:
    """Convert a TimescaleDB kline row to a NautilusTrader Bar.

    IRH schema → NT mapping (per CLAUDE.md):
      ts    → ts_event
      open/high/low/close → Price objects (precision=8)
      volume → Quantity (precision=8)
    """
    ts_ns = dt_to_unix_nanos(row["ts"])
    return Bar(
        bar_type=bar_type,
        open=Price(float(row["open"]), precision=8),
        high=Price(float(row["high"]), precision=8),
        low=Price(float(row["low"]),   precision=8),
        close=Price(float(row["close"]), precision=8),
        volume=Quantity(float(row["volume"]), precision=8),
        ts_event=ts_ns,
        ts_init=ts_ns,
    )


async def load_bars(
    pool: asyncpg.Pool,
    exchange: str,
    symbol: str,
    start: datetime,
    end: datetime,
    interval: str = "1m",
) -> list[Bar]:
    """Load klines from TimescaleDB and return a time-sorted list of NT Bars."""
    bar_type = _make_bar_type(exchange, symbol)

    if interval == "1m":
        query = """
            SELECT ts, open, high, low, close, volume
            FROM klines
            WHERE exchange = $1 AND symbol = $2
              AND ts >= $3 AND ts <= $4
            ORDER BY ts ASC
        """
        async with pool.acquire() as conn:
            rows = await conn.fetch(query, exchange, symbol, start, end)
    else:
        query = """
            SELECT ts, open, high, low, close, volume
            FROM klines_native
            WHERE exchange = $1 AND symbol = $2 AND interval = $3
              AND ts >= $4 AND ts <= $5
            ORDER BY ts ASC
        """
        async with pool.acquire() as conn:
            rows = await conn.fetch(query, exchange, symbol, interval, start, end)

    return [_row_to_bar(r, bar_type) for r in rows]
