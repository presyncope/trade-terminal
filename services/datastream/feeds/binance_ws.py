"""
Binance WebSocket feed — real-time kline & trade stream.

Subscribes to combined streams for multiple symbols via a single
WebSocket connection (Binance supports up to 1024 streams per conn).
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Callable, Awaitable

import aiohttp

logger = logging.getLogger("datastream.binance")

# Binance WebSocket endpoints
SPOT_WS = "wss://stream.binance.com:9443/stream"
SPOT_WS_TESTNET = "wss://testnet.binance.vision/stream"
FUTURES_WS = "wss://fstream.binance.com/stream"
FUTURES_WS_TESTNET = "wss://stream.binancefuture.com/stream"

KlineCallback = Callable[[str, str, dict], Awaitable[None]]
TickCallback = Callable[[str, str, dict], Awaitable[None]]


class BinanceWebSocketFeed:
    """
    Connects to Binance combined WebSocket stream and dispatches
    normalized kline/tick events via callbacks.
    """

    def __init__(
        self,
        exchange_id: str,
        symbols: list[str],
        testnet: bool = True,
        futures: bool = False,
        on_kline: KlineCallback | None = None,
        on_tick: TickCallback | None = None,
    ):
        self.exchange_id = exchange_id
        self.symbols = [s.lower() for s in symbols]
        self.on_kline = on_kline
        self.on_tick = on_tick
        self._ws: aiohttp.ClientWebSocketResponse | None = None
        self._session: aiohttp.ClientSession | None = None
        self._running = False

        if futures:
            self.ws_url = FUTURES_WS_TESTNET if testnet else FUTURES_WS
        else:
            self.ws_url = SPOT_WS_TESTNET if testnet else SPOT_WS

    async def connect(self):
        """Connect and start listening."""
        # Build combined stream subscription
        streams = []
        for sym in self.symbols:
            streams.append(f"{sym}@kline_1m")
            streams.append(f"{sym}@aggTrade")

        url = f"{self.ws_url}?streams={'/'.join(streams)}"

        self._running = True
        self._session = aiohttp.ClientSession()

        while self._running:
            try:
                async with self._session.ws_connect(url) as ws:
                    self._ws = ws
                    logger.info(f"[{self.exchange_id}] Connected to {len(self.symbols)} streams")
                    async for msg in ws:
                        if not self._running:
                            break
                        if msg.type == aiohttp.WSMsgType.TEXT:
                            await self._handle_message(json.loads(msg.data))
                        elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                            break
            except Exception:
                if self._running:
                    logger.exception(f"[{self.exchange_id}] Connection error, reconnecting in 5s")
                    await asyncio.sleep(5)

        if self._session:
            await self._session.close()

    async def disconnect(self):
        self._running = False
        if self._ws:
            await self._ws.close()

    async def _handle_message(self, data: dict):
        """Parse Binance combined stream message and dispatch."""
        stream = data.get("stream", "")
        payload = data.get("data", {})

        if "@kline" in stream and self.on_kline:
            k = payload["k"]
            symbol = k["s"]  # e.g. "BTCUSDT"
            kline = {
                "ts": datetime.fromtimestamp(k["t"] / 1000, tz=timezone.utc).isoformat(),
                "open": float(k["o"]),
                "high": float(k["h"]),
                "low": float(k["l"]),
                "close": float(k["c"]),
                "volume": float(k["v"]),
                "turnover": float(k["q"]),
                "closed": k["x"],  # is this candle closed?
            }
            await self.on_kline(self.exchange_id, symbol, kline)

        elif "@aggTrade" in stream and self.on_tick:
            symbol = payload["s"]
            tick = {
                "ts": datetime.fromtimestamp(payload["T"] / 1000, tz=timezone.utc).isoformat(),
                "price": float(payload["p"]),
                "quantity": float(payload["q"]),
                "side": "SELL" if payload["m"] else "BUY",
            }
            await self.on_tick(self.exchange_id, symbol, tick)
