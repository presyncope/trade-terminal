"""Backtest orchestrator: loads bars, feeds strategy, returns metrics."""

from __future__ import annotations

from datetime import datetime

import asyncpg

from .data_loader import load_bars
from .metrics import BacktestMetrics, compute_metrics
from ..strategies.base import IRHStrategy


async def run_backtest(
    pool: asyncpg.Pool,
    strategy: IRHStrategy,
    exchange: str,
    symbol: str,
    start: datetime,
    end: datetime,
    interval: str = "1m",
    initial_capital: float = 10_000.0,
) -> BacktestMetrics:
    """Full backtest pipeline:

    1. Load NT Bars from TimescaleDB for the given period
    2. Feed each bar through strategy.on_bar()
    3. Compute and return BacktestMetrics from accumulated signals
    """
    bars = await load_bars(pool, exchange, symbol, start, end, interval)
    strategy.reset()
    for bar in bars:
        strategy.on_bar(bar)
    signals = strategy.get_signals()
    return compute_metrics(signals, initial_capital)
