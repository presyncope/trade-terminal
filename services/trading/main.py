"""
Trading Node — Strategy execution & manual order handler.

Core responsibilities:
  1. Run automated trading strategies (NautilusTrader-based)
  2. Listen for manual order commands from Redis (sent by web-api)
  3. Publish fill events to Redis for frontend display
"""

from __future__ import annotations

import asyncio
import json
import logging
import signal
import sys
from datetime import datetime, timezone

sys.path.insert(0, "/app")
from services.shared.config import RedisConfig, BinanceConfig, Channels
from services.shared.redis_client import create_redis
from services.trading.executor import OrderExecutor

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")
logger = logging.getLogger("trading")


class TradingNode:
    """
    Manages strategy execution and manual order processing.

    In the full implementation, this would embed a NautilusTrader
    TradingNode with configured adapters. For the skeleton, we use
    a simplified OrderExecutor that talks directly to exchange APIs.
    """

    def __init__(self):
        self.redis = create_redis()
        self.executor = OrderExecutor()
        self._running = True

    async def start(self):
        """Start the trading node."""
        await self.executor.initialize()

        # Start command listener + strategy runner concurrently
        tasks = [
            asyncio.create_task(self._listen_order_commands()),
            asyncio.create_task(self._listen_cancel_commands()),
            # TODO: asyncio.create_task(self._run_strategies()),
        ]

        loop = asyncio.get_running_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, lambda: asyncio.create_task(self.stop()))

        logger.info("Trading Node started")
        await asyncio.gather(*tasks)

    async def stop(self):
        self._running = False
        await self.executor.shutdown()
        await self.redis.close()
        logger.info("Trading Node stopped")

    async def _listen_order_commands(self):
        """Subscribe to manual order commands from web-api."""
        pubsub = self.redis.pubsub()
        await pubsub.subscribe(Channels.CMD_ORDER)
        logger.info(f"Listening for order commands on '{Channels.CMD_ORDER}'")

        async for msg in pubsub.listen():
            if msg["type"] != "message":
                continue
            try:
                cmd = json.loads(msg["data"])
                # Expected payload:
                # {
                #   "exchange": "binance_spot",
                #   "symbol": "BTCUSDT",
                #   "side": "BUY",
                #   "type": "MARKET",         # MARKET | LIMIT
                #   "quantity": 0.001,
                #   "price": null,            # required for LIMIT
                #   "client_order_id": "...", # optional
                # }
                fill = await self.executor.submit_order(cmd)
                if fill:
                    await self._publish_fill(fill)
            except Exception:
                logger.exception("Error processing order command")

    async def _listen_cancel_commands(self):
        """Subscribe to cancel order commands."""
        pubsub = self.redis.pubsub()
        await pubsub.subscribe(Channels.CMD_CANCEL)

        async for msg in pubsub.listen():
            if msg["type"] != "message":
                continue
            try:
                cmd = json.loads(msg["data"])
                await self.executor.cancel_order(cmd)
            except Exception:
                logger.exception("Error processing cancel command")

    async def _publish_fill(self, fill: dict):
        """Publish fill event to Redis for frontend consumption."""
        channel = Channels.fill(fill["exchange"], fill["symbol"])
        await self.redis.publish(channel, json.dumps(fill))
        logger.info(f"Fill published: {fill['side']} {fill['quantity']} {fill['symbol']} @ {fill['price']}")


async def main():
    node = TradingNode()
    await node.start()


if __name__ == "__main__":
    asyncio.run(main())
