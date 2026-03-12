"""MLflow experiment and run lifecycle management."""

from __future__ import annotations

import os

import mlflow

MLFLOW_TRACKING_URI = os.getenv("MLFLOW_TRACKING_URI", "http://mlflow:5000")


class MLflowTracker:
    """Wraps MLflow experiment and run lifecycle for IRH strategy experiments.

    Experiment name pattern: "{strategy_id}/{exchange}/{symbol}"
    Each optimize job: parent run wrapping nested child runs (one per hyperopt trial).
    Single backtest: standalone run with no nesting.
    """

    def __init__(self, strategy_id: str, exchange: str, symbol: str) -> None:
        mlflow.set_tracking_uri(MLFLOW_TRACKING_URI)
        self.experiment_name = f"{strategy_id}/{exchange}/{symbol}"
        mlflow.set_experiment(self.experiment_name)
        self._parent_run_id: str | None = None

    def start_experiment_run(
        self,
        params: dict,
        tags: dict | None = None,
    ) -> str:
        """Start a parent MLflow run for a full optimization job. Returns run_id."""
        run = mlflow.start_run(tags=tags or {})
        self._parent_run_id = run.info.run_id
        mlflow.log_params(params)
        return self._parent_run_id

    def end_experiment_run(self, best_params: dict, best_metrics: dict) -> None:
        """Log best results and close the parent run."""
        mlflow.log_params({f"best_{k}": v for k, v in best_params.items()})
        # Filter out non-finite floats before logging
        safe_metrics = {
            k: (v if v != float("inf") else 9999.0)
            for k, v in best_metrics.items()
            if isinstance(v, (int, float))
        }
        mlflow.log_metrics({f"best_{k}": v for k, v in safe_metrics.items()})
        mlflow.end_run()

    def log_trial(
        self,
        run_id_prefix: str,
        params: dict,
        metrics: dict,
        loss: float,
    ) -> None:
        """Log a single hyperopt trial as a nested child run."""
        with mlflow.start_run(run_name=f"{run_id_prefix}_trial", nested=True):
            mlflow.log_params(params)
            safe_metrics = {
                k: (v if v != float("inf") else 9999.0)
                for k, v in metrics.items()
                if isinstance(v, (int, float))
            }
            mlflow.log_metrics({**safe_metrics, "hyperopt_loss": loss})

    def log_single_run(
        self,
        params: dict,
        metrics: dict,
        run_name: str | None = None,
    ) -> str:
        """Log a standalone backtest (no hyperopt nesting). Returns MLflow run_id."""
        with mlflow.start_run(run_name=run_name) as run:
            mlflow.log_params(params)
            safe_metrics = {
                k: (v if v != float("inf") else 9999.0)
                for k, v in metrics.items()
                if isinstance(v, (int, float))
            }
            mlflow.log_metrics(safe_metrics)
            return run.info.run_id
