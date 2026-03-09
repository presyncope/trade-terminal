"""
DataStream Node — Real-time market data broadcaster.

Connects to exchange WebSocket feeds and re-publishes
normalized kline/tick events to Redis Pub/Sub.
This decouples all downstream consumers from exchange-specific
rate limits and connection management.
"""

from __future__ import annotations

import asyncio
import json
import logging
import signal
import sys

sys.path.insert(0, "/app")
from services.shared.config import RedisConfig, BinanceConfig, Channels
from services.shared.redis_client import create_redis
from services.datastream.feeds.binance_ws import BinanceWebSocketFeed

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")
logger = logging.getLogger("datastream")


class DataStreamNode:
    """
    Manages multiple exchange WebSocket feeds and broadcasts
    normalized data to Redis.
    """

    def __init__(self):
        self.redis = create_redis()
        self.feeds: list = []
        self._running = True

    async def start(self):
        """Initialize feeds and start broadcasting."""
        # ─── Binance Spot ──────────────────────────────
        binance_cfg = BinanceConfig()
        binance_spot = BinanceWebSocketFeed(
            exchange_id="binance_spot",
            symbols=["BTCUSDT", "ETHUSDT"],  # TODO: make configurable
            testnet=binance_cfg.testnet,
            futures=False,
            on_kline=self._on_kline,
            on_tick=self._on_tick,
        )
        self.feeds.append(binance_spot)

        # ─── Binance Futures ───────────────────────────
        binance_futures = BinanceWebSocketFeed(
            exchange_id="binance_futures",
            symbols=["BTCUSDT", "ETHUSDT"],
            testnet=binance_cfg.testnet,
            futures=True,
            on_kline=self._on_kline,
            on_tick=self._on_tick,
        )
        self.feeds.append(binance_futures)

        # TODO: HyperliquidWebSocketFeed

        # Start all feeds concurrently
        tasks = [asyncio.create_task(feed.connect()) for feed in self.feeds]

        # Graceful shutdown
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, lambda: asyncio.create_task(self.stop()))

        logger.info(f"DataStream started with {len(self.feeds)} feeds")
        await asyncio.gather(*tasks)

    async def stop(self):
        self._running = False
        for feed in self.feeds:
            await feed.disconnect()
        await self.redis.close()
        logger.info("DataStream stopped")

    async def _on_kline(self, exchange: str, symbol: str, kline: dict):
        """Publish normalized kline to Redis."""
        channel = Channels.kline(exchange, symbol)
        await self.redis.publish(channel, json.dumps(kline))

    async def _on_tick(self, exchange: str, symbol: str, tick: dict):
        """Publish normalized tick to Redis."""
        channel = Channels.tick(exchange, symbol)
        await self.redis.publish(channel, json.dumps(tick))


async def main():
    node = DataStreamNode()
    await node.start()


if __name__ == "__main__":
    asyncio.run(main())
