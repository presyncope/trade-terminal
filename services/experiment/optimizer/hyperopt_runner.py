"""Hyperopt TPE parameter search for IRH strategies."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import asdict
from datetime import datetime

import asyncpg
from hyperopt import STATUS_FAIL, STATUS_OK, Trials, fmin, tpe

from ..backtest.runner import run_backtest
from ..strategies.base import IRHStrategy

logger = logging.getLogger("experiment.optimizer")

# Fields that come back as float from hyperopt quniform but must be int
_INT_PARAMS = {"fast_period", "slow_period"}


def _cast_params(strategy_class: type[IRHStrategy], raw: dict) -> dict:
    """Cast quniform floats → int for known integer hyperparameter fields."""
    return {k: int(v) if k in _INT_PARAMS else v for k, v in raw.items()}


def _build_objective(
    strategy_class: type[IRHStrategy],
    pool: asyncpg.Pool,
    exchange: str,
    symbol: str,
    start: datetime,
    end: datetime,
    interval: str,
    initial_capital: float,
    mlflow_tracker,
    run_id_prefix: str,
    loop: asyncio.AbstractEventLoop,
):
    """Return a synchronous hyperopt objective function.

    hyperopt's fmin() is synchronous; we bridge into async via the event loop.
    The objective minimises negative Sharpe ratio (maximise Sharpe).
    """

    def objective(raw_params: dict) -> dict:
        cast = _cast_params(strategy_class, raw_params)
        params_obj = strategy_class.params_class(**cast)
        strategy   = strategy_class(params_obj)

        try:
            metrics = loop.run_until_complete(
                run_backtest(
                    pool=pool,
                    strategy=strategy,
                    exchange=exchange,
                    symbol=symbol,
                    start=start,
                    end=end,
                    interval=interval,
                    initial_capital=initial_capital,
                )
            )
        except Exception as exc:
            logger.warning(f"Trial failed: {exc}")
            return {"status": STATUS_FAIL, "error": str(exc)}

        loss = -metrics.sharpe_ratio
        metrics_dict = asdict(metrics)

        if mlflow_tracker is not None:
            try:
                mlflow_tracker.log_trial(
                    run_id_prefix=run_id_prefix,
                    params=cast,
                    metrics=metrics_dict,
                    loss=loss,
                )
            except Exception as exc:
                logger.warning(f"MLflow trial log failed: {exc}")

        return {"status": STATUS_OK, "loss": loss, "metrics": metrics_dict}

    return objective


def run_hyperopt(
    strategy_class: type[IRHStrategy],
    pool: asyncpg.Pool,
    exchange: str,
    symbol: str,
    start: datetime,
    end: datetime,
    interval: str = "1m",
    max_evals: int = 50,
    initial_capital: float = 10_000.0,
    mlflow_tracker=None,
    run_id_prefix: str = "",
) -> tuple[dict, Trials]:
    """Run Hyperopt TPE search over strategy_class.PARAM_SPACE.

    Returns (best_params_dict, Trials).
    best_params values may be floats — use _cast_params() before constructing
    strategy params if integer fields are expected.
    """
    loop = asyncio.get_event_loop()
    trials = Trials()

    objective = _build_objective(
        strategy_class=strategy_class,
        pool=pool,
        exchange=exchange,
        symbol=symbol,
        start=start,
        end=end,
        interval=interval,
        initial_capital=initial_capital,
        mlflow_tracker=mlflow_tracker,
        run_id_prefix=run_id_prefix,
        loop=loop,
    )

    best = fmin(
        fn=objective,
        space=strategy_class.PARAM_SPACE,
        algo=tpe.suggest,
        max_evals=max_evals,
        trials=trials,
        verbose=False,
    )

    return best, trials
