"""SMA Crossover strategy — buy when fast SMA crosses above slow SMA, sell on cross below."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass

from hyperopt import hp

from .base import IRHStrategy, StrategyParams


@dataclass
class SMAParams(StrategyParams):
    fast_period: int   = 10
    slow_period: int   = 30
    quantity:    float = 0.001


class SMACrossoverStrategy(IRHStrategy):
    """Classic dual-SMA crossover.

    PARAM_SPACE keys match SMAParams fields exactly so hyperopt-sampled dicts
    can be unpacked directly into SMAParams(**params).
    """

    STRATEGY_ID = "sma_crossover"
    params_class = SMAParams
    PARAM_SPACE = {
        "fast_period": hp.quniform("fast_period", 5,   50,  1),
        "slow_period": hp.quniform("slow_period", 20, 200,  1),
        "quantity":    hp.choice("quantity", [0.001, 0.01, 0.1]),
    }

    def __init__(self, params: SMAParams) -> None:
        super().__init__(params)
        self._fast: deque[float] = deque(maxlen=params.fast_period)
        self._slow: deque[float] = deque(maxlen=params.slow_period)
        self._in_position = False

    def reset(self) -> None:
        super().reset()
        self._fast.clear()
        self._slow.clear()
        self._in_position = False

    def on_bar(self, bar) -> None:
        close = float(bar.close)
        self._fast.append(close)
        self._slow.append(close)

        if len(self._fast) < self._fast.maxlen or len(self._slow) < self._slow.maxlen:
            return  # warm-up period

        fast_sma = sum(self._fast) / len(self._fast)
        slow_sma = sum(self._slow) / len(self._slow)

        if fast_sma > slow_sma and not self._in_position:
            self._signal_buy(bar, self.params.quantity)
            self._in_position = True
        elif fast_sma < slow_sma and self._in_position:
            self._signal_sell(bar, self.params.quantity)
            self._in_position = False
