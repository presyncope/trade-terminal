"""
Experiment Service — Backtest runner, Hyperopt optimizer, MLflow tracker.

Triggered via:
  1. Redis cmd:experiment channel (from web-api POST /api/experiment)
  2. CLI: python -m services.experiment.main run <strategy_id> <exchange> <symbol> <start> <end> [single|optimize]
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
from dataclasses import asdict
from datetime import datetime, timezone

sys.path.insert(0, "/app")

from services.shared.config import Channels
from services.shared.db import create_pool
from services.shared.redis_client import create_redis
from services.experiment.backtest.runner import run_backtest
from services.experiment.db import save_backtest_run
from services.experiment.optimizer.hyperopt_runner import _cast_params, run_hyperopt
from services.experiment.strategies.sma_crossover import SMACrossoverStrategy, SMAParams
from services.experiment.tracking.mlflow_tracker import MLflowTracker

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")
logger = logging.getLogger("experiment")

# ─── Strategy Registry ───────────────────────────────────
STRATEGY_REGISTRY: dict[str, type] = {
    "sma_crossover": SMACrossoverStrategy,
}


# ─── Command Handler ─────────────────────────────────────

async def handle_command(payload: dict, pool, redis) -> None:
    """
    Dispatch a single experiment command.

    Expected payload keys:
      strategy_id  str
      exchange     str
      symbol       str
      start        ISO-8601 datetime string
      end          ISO-8601 datetime string
      interval     str  (default "1m")
      mode         "single" | "optimize"
      params       dict  (mode=single only)
      max_evals    int   (mode=optimize, default 50)
    """
    strategy_id = payload.get("strategy_id", "")
    strategy_class = STRATEGY_REGISTRY.get(strategy_id)
    if not strategy_class:
        logger.error(f"Unknown strategy_id: '{strategy_id}'")
        return

    exchange = payload["exchange"]
    symbol   = payload["symbol"]
    start    = datetime.fromisoformat(payload["start"]).replace(tzinfo=timezone.utc)
    end      = datetime.fromisoformat(payload["end"]).replace(tzinfo=timezone.utc)
    interval = payload.get("interval", "1m")
    mode     = payload.get("mode", "single")

    tracker = MLflowTracker(strategy_id, exchange, symbol)

    if mode == "single":
        raw_params = payload.get("params") or {}
        cast       = _cast_params(strategy_class, raw_params) if raw_params else {}
        params_obj = strategy_class.params_class(**cast) if cast else strategy_class.params_class()
        strategy   = strategy_class(params_obj)

        metrics = await run_backtest(pool, strategy, exchange, symbol, start, end, interval)
        metrics_dict = asdict(metrics)

        try:
            mlflow_run_id = tracker.log_single_run(params=raw_params, metrics=metrics_dict)
        except Exception as exc:
            logger.warning(f"MLflow log failed: {exc}")
            mlflow_run_id = None

        run_id = await save_backtest_run(
            pool=pool,
            strategy_id=strategy_id,
            exchange=exchange,
            symbol=symbol,
            interval=interval,
            params=raw_params,
            metrics=metrics_dict,
            start=start,
            end=end,
            mlflow_run_id=mlflow_run_id,
            mode="single",
        )

        result = {"run_id": run_id, "strategy_id": strategy_id, "metrics": metrics_dict}
        await redis.publish(Channels.EXPERIMENT_DONE, json.dumps(result))
        logger.info(
            f"Single run complete: {strategy_id} {exchange}:{symbol} "
            f"sharpe={metrics.sharpe_ratio:.3f} return={metrics.total_return:.2%}"
        )

    elif mode == "optimize":
        max_evals = int(payload.get("max_evals", 50))
        run_id_prefix = f"{strategy_id}_{symbol}"

        try:
            tracker.start_experiment_run(params={"max_evals": max_evals, "mode": "optimize"})
        except Exception as exc:
            logger.warning(f"MLflow start_run failed: {exc}")

        best_raw, _trials = run_hyperopt(
            strategy_class=strategy_class,
            pool=pool,
            exchange=exchange,
            symbol=symbol,
            start=start,
            end=end,
            interval=interval,
            max_evals=max_evals,
            mlflow_tracker=tracker,
            run_id_prefix=run_id_prefix,
        )

        best_cast = _cast_params(strategy_class, best_raw)
        best_params_obj = strategy_class.params_class(**best_cast)
        best_strategy   = strategy_class(best_params_obj)
        best_metrics    = await run_backtest(pool, best_strategy, exchange, symbol, start, end, interval)
        best_metrics_dict = asdict(best_metrics)

        try:
            tracker.end_experiment_run(best_cast, best_metrics_dict)
        except Exception as exc:
            logger.warning(f"MLflow end_run failed: {exc}")

        run_id = await save_backtest_run(
            pool=pool,
            strategy_id=strategy_id,
            exchange=exchange,
            symbol=symbol,
            interval=interval,
            params=best_cast,
            metrics=best_metrics_dict,
            start=start,
            end=end,
            mlflow_run_id=None,
            mode="optimize",
        )

        result = {
            "run_id":      run_id,
            "strategy_id": strategy_id,
            "best_params": best_cast,
            "metrics":     best_metrics_dict,
        }
        await redis.publish(Channels.EXPERIMENT_DONE, json.dumps(result))
        logger.info(
            f"Optimize complete: {strategy_id} {exchange}:{symbol} "
            f"best_sharpe={best_metrics.sharpe_ratio:.3f} params={best_cast}"
        )
    else:
        logger.error(f"Unknown mode: '{mode}'")


# ─── Redis Daemon ─────────────────────────────────────────

async def listen_commands(pool, redis) -> None:
    pubsub = redis.pubsub()
    await pubsub.subscribe(Channels.CMD_EXPERIMENT)
    logger.info(f"Listening for experiment commands on '{Channels.CMD_EXPERIMENT}'")

    async for msg in pubsub.listen():
        if msg["type"] != "message":
            continue
        try:
            payload = json.loads(msg["data"])
            await handle_command(payload, pool, redis)
        except Exception:
            logger.exception("Error processing experiment command")


# ─── Entry Point ──────────────────────────────────────────

async def main() -> None:
    pool  = await create_pool()
    redis = create_redis()

    try:
        if len(sys.argv) > 1 and sys.argv[1] == "run":
            # CLI mode:
            # python -m services.experiment.main run sma_crossover binance_spot BTCUSDT 2024-01-01 2024-06-01 [single|optimize]
            payload = {
                "strategy_id": sys.argv[2],
                "exchange":    sys.argv[3],
                "symbol":      sys.argv[4],
                "start":       sys.argv[5],
                "end":         sys.argv[6],
                "mode":        sys.argv[7] if len(sys.argv) > 7 else "single",
            }
            await handle_command(payload, pool, redis)
        else:
            await listen_commands(pool, redis)
    finally:
        await pool.close()
        await redis.aclose()


if __name__ == "__main__":
    asyncio.run(main())
