"""Backtest performance metric computation."""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass
class BacktestMetrics:
    total_return: float    # fractional, e.g. 0.15 = +15%
    sharpe_ratio: float    # annualised
    max_drawdown: float    # fractional, e.g. -0.20 = -20% peak-to-trough
    win_rate: float        # fractional, e.g. 0.55 = 55% winning trades
    total_trades: int
    profit_factor: float   # gross_profit / abs(gross_loss); inf if no losses
    avg_trade_pnl: float   # average P&L per round-trip trade


def compute_metrics(
    signals: list[dict],
    initial_capital: float = 10_000.0,
) -> BacktestMetrics:
    """Compute performance metrics from signal list.

    Signals are dicts: {ts, side, price, quantity}.
    Pairs BUY → SELL as round-trip trades.
    Unpaired open positions are ignored (no forced close at last bar).
    """
    if not signals:
        return BacktestMetrics(0.0, 0.0, 0.0, 0.0, 0, 0.0, 0.0)

    equity = initial_capital
    peak   = equity
    max_dd = 0.0
    trade_pnls: list[float] = []
    open_position: dict | None = None
    equity_curve: list[float] = [equity]

    for sig in signals:
        if sig["side"] == "BUY" and open_position is None:
            open_position = sig
        elif sig["side"] == "SELL" and open_position is not None:
            entry = open_position["price"]
            exit_ = sig["price"]
            qty   = sig["quantity"]
            pnl   = (exit_ - entry) * qty
            trade_pnls.append(pnl)
            equity += pnl
            equity_curve.append(equity)
            peak   = max(peak, equity)
            dd     = (equity - peak) / peak if peak > 0 else 0.0
            max_dd = min(max_dd, dd)
            open_position = None

    total_trades = len(trade_pnls)
    if total_trades == 0:
        return BacktestMetrics(0.0, 0.0, 0.0, 0.0, 0, 0.0, 0.0)

    total_return = (equity - initial_capital) / initial_capital
    wins   = [p for p in trade_pnls if p > 0]
    losses = [p for p in trade_pnls if p <= 0]
    win_rate = len(wins) / total_trades

    gross_profit = sum(wins)
    gross_loss   = abs(sum(losses)) if losses else 0.0
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else float("inf")
    avg_trade_pnl = sum(trade_pnls) / total_trades

    # Annualised Sharpe from per-trade equity returns (assumes 252 trading days)
    if len(equity_curve) > 2:
        returns = [
            (equity_curve[i] - equity_curve[i - 1]) / equity_curve[i - 1]
            for i in range(1, len(equity_curve))
        ]
        mean_r = sum(returns) / len(returns)
        var_r  = sum((r - mean_r) ** 2 for r in returns) / len(returns)
        std_r  = math.sqrt(var_r) if var_r > 0 else 0.0
        sharpe = (mean_r / std_r * math.sqrt(252)) if std_r > 0 else 0.0
    else:
        sharpe = 0.0

    return BacktestMetrics(
        total_return=total_return,
        sharpe_ratio=sharpe,
        max_drawdown=max_dd,
        win_rate=win_rate,
        total_trades=total_trades,
        profit_factor=profit_factor,
        avg_trade_pnl=avg_trade_pnl,
    )
