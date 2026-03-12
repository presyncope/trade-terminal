"""Shared configuration loaded from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass, field


@dataclass(frozen=True)
class TimescaleConfig:
    host: str = field(default_factory=lambda: os.getenv("TIMESCALE_HOST", "localhost"))
    port: int = field(default_factory=lambda: int(os.getenv("TIMESCALE_PORT", "5432")))
    user: str = field(default_factory=lambda: os.getenv("TIMESCALE_USER", "trader"))
    password: str = field(default_factory=lambda: os.getenv("TIMESCALE_PASSWORD", "trader_pass"))
    db: str = field(default_factory=lambda: os.getenv("TIMESCALE_DB", "trade_hub"))

    @property
    def dsn(self) -> str:
        return f"postgresql://{self.user}:{self.password}@{self.host}:{self.port}/{self.db}"


@dataclass(frozen=True)
class RedisConfig:
    host: str = field(default_factory=lambda: os.getenv("REDIS_HOST", "localhost"))
    port: int = field(default_factory=lambda: int(os.getenv("REDIS_PORT", "6379")))

    @property
    def url(self) -> str:
        return f"redis://{self.host}:{self.port}"


@dataclass(frozen=True)
class BinanceConfig:
    api_key: str = field(default_factory=lambda: os.getenv("BINANCE_API_KEY", ""))
    api_secret: str = field(default_factory=lambda: os.getenv("BINANCE_API_SECRET", ""))
    testnet: bool = field(default_factory=lambda: os.getenv("BINANCE_TESTNET", "true").lower() == "true")


@dataclass(frozen=True)
class HyperliquidConfig:
    api_key: str = field(default_factory=lambda: os.getenv("HYPERLIQUID_API_KEY", ""))
    api_secret: str = field(default_factory=lambda: os.getenv("HYPERLIQUID_API_SECRET", ""))


# ─── Redis Channel Naming Convention ─────────────────────
# Pattern: {domain}:{exchange}:{symbol}
# Examples:
#   kline:binance_spot:BTCUSDT      -> real-time 1m candle updates
#   tick:binance_futures:ETHUSDT    -> real-time tick data
#   fill:binance_spot:BTCUSDT      -> trade fill events
#   fill:*                          -> all fill events (pattern sub)
#   cmd:order                       -> manual order commands from frontend
#   cmd:cancel                      -> cancel order commands
class Channels:
    @staticmethod
    def kline(exchange: str, symbol: str) -> str:
        return f"kline:{exchange}:{symbol}"

    @staticmethod
    def tick(exchange: str, symbol: str) -> str:
        return f"tick:{exchange}:{symbol}"

    @staticmethod
    def fill(exchange: str, symbol: str) -> str:
        return f"fill:{exchange}:{symbol}"

    FILL_ALL = "fill:*"
    CMD_ORDER = "cmd:order"
    CMD_CANCEL = "cmd:cancel"
    CMD_EXPERIMENT = "cmd:experiment"
    EXPERIMENT_DONE = "experiment:done"
