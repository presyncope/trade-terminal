"""Base classes for IRH experiment strategies."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class StrategyParams:
    """Typed parameter container. Subclasses add their own fields."""
    pass


class IRHStrategy(ABC):
    """Base class for all IRH experiment strategies.

    Subclasses must declare:
      STRATEGY_ID: str         — unique identifier stored in DB / MLflow
      PARAM_SPACE: dict        — hyperopt hp.* expressions keyed by param name
      params_class: type       — StrategyParams subclass used for instantiation

    The on_bar() method receives NautilusTrader Bar objects during backtesting.
    For live execution, submit_order() calls go through the cmd:order Redis
    channel rather than calling exchange APIs directly.
    """

    STRATEGY_ID: str = "base"
    PARAM_SPACE: dict = {}
    params_class: type = StrategyParams

    def __init__(self, params: StrategyParams) -> None:
        self.params = params
        self._orders: list[dict] = []

    @abstractmethod
    def on_bar(self, bar) -> None:
        """Called for each NT Bar. Implementations call _signal_buy/_signal_sell."""
        ...

    def _signal_buy(self, bar, quantity: float = 1.0) -> None:
        self._orders.append({
            "ts":       str(bar.ts_event),
            "side":     "BUY",
            "price":    float(bar.close),
            "quantity": quantity,
        })

    def _signal_sell(self, bar, quantity: float = 1.0) -> None:
        self._orders.append({
            "ts":       str(bar.ts_event),
            "side":     "SELL",
            "price":    float(bar.close),
            "quantity": quantity,
        })

    def reset(self) -> None:
        """Clear accumulated signals. Called before each backtest run."""
        self._orders = []

    def get_signals(self) -> list[dict]:
        """Return a copy of accumulated {ts, side, price, quantity} signals."""
        return list(self._orders)
