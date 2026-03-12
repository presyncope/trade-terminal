"""Persistence helpers for experiment results."""

from __future__ import annotations

import json
from datetime import datetime

import asyncpg


async def save_backtest_run(
    pool: asyncpg.Pool,
    strategy_id: str,
    exchange: str,
    symbol: str,
    interval: str,
    params: dict,
    metrics: dict,
    start: datetime,
    end: datetime,
    mlflow_run_id: str | None = None,
    mode: str = "single",
) -> int:
    """Insert a completed backtest result into backtest_runs. Returns the row id."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO backtest_runs
              (strategy_id, exchange, symbol, interval, start_ts, end_ts,
               params, total_return, sharpe_ratio, max_drawdown,
               win_rate, total_trades, profit_factor, avg_trade_pnl,
               mlflow_run_id, mode)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
            RETURNING id
            """,
            strategy_id, exchange, symbol, interval, start, end,
            json.dumps(params),
            float(metrics["total_return"]),
            float(metrics["sharpe_ratio"]),
            float(metrics["max_drawdown"]),
            float(metrics["win_rate"]),
            int(metrics["total_trades"]),
            float(metrics["profit_factor"]) if metrics["profit_factor"] != float("inf") else 9999.0,
            float(metrics["avg_trade_pnl"]),
            mlflow_run_id,
            mode,
        )
    return row["id"]
