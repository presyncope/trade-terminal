"""
Web API Node (BFF) — FastAPI middleware between Frontend and Backend.

Responsibilities:
  1. REST: Serve historical kline data from TimescaleDB
  2. WebSocket: Relay real-time klines & fills from Redis to frontend
  3. REST/WS: Forward manual order commands to Trading Node via Redis
"""

from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime

import asyncpg
import redis.asyncio as aioredis
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware

import sys
sys.path.insert(0, "/app")
from services.shared.config import TimescaleConfig, RedisConfig, Channels
from services.shared.db import create_pool
from services.shared.redis_client import create_redis

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")
logger = logging.getLogger("web-api")

# ─── App State ────────────────────────────────────────────
db_pool: asyncpg.Pool | None = None
redis_client: aioredis.Redis | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global db_pool, redis_client
    db_pool = await create_pool()
    redis_client = create_redis()
    logger.info("Web API started — DB pool and Redis connected")
    yield
    await db_pool.close()
    await redis_client.close()
    logger.info("Web API stopped")


app = FastAPI(title="IRH Trading Terminal API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Timeframe → table/view mapping ──────────────────────
INTERVAL_TABLE = {
    "1m":  "klines",
    "5m":  "klines_5m",
    "15m": "klines_15m",
    "1h":  "klines_1h",
    "4h":  "klines_4h",
    "1d":  "klines_1d",
}


# ═══════════════════════════════════════════════════════════
# REST ENDPOINTS
# ═══════════════════════════════════════════════════════════

@app.get("/api/klines")
async def get_klines(
    exchange: str = Query(..., description="Exchange ID, e.g. 'binance_spot'"),
    symbol: str = Query(..., description="Trading pair, e.g. 'BTCUSDT'"),
    interval: str = Query("1m", description="Timeframe: 1m, 5m, 15m, 1h, 4h, 1d"),
    start: datetime | None = Query(None, description="Start time (ISO 8601)"),
    end: datetime | None = Query(None, description="End time (ISO 8601)"),
    limit: int = Query(500, ge=1, le=5000, description="Max rows to return"),
):
    """
    Fetch historical kline data from TimescaleDB.

    Returns array of [timestamp_ms, open, high, low, close, volume].
    Compatible with TradingView Lightweight Charts data format.
    """
    table = INTERVAL_TABLE.get(interval, "klines")

    query = f"""
        SELECT ts, open, high, low, close, volume
        FROM {table}
        WHERE exchange = $1 AND symbol = $2
    """
    params: list = [exchange, symbol]
    idx = 3

    if start:
        query += f" AND ts >= ${idx}"
        params.append(start)
        idx += 1
    if end:
        query += f" AND ts <= ${idx}"
        params.append(end)
        idx += 1

    query += f" ORDER BY ts ASC LIMIT ${idx}"
    params.append(limit)

    async with db_pool.acquire() as conn:
        rows = await conn.fetch(query, *params)

    return [
        {
            "time": int(row["ts"].timestamp()),
            "open": row["open"],
            "high": row["high"],
            "low": row["low"],
            "close": row["close"],
            "volume": row["volume"],
        }
        for row in rows
    ]


@app.get("/api/fills")
async def get_fills(
    exchange: str | None = Query(None),
    symbol: str | None = Query(None),
    limit: int = Query(100, ge=1, le=1000),
):
    """Fetch recent fill/trade history from TimescaleDB."""
    query = "SELECT * FROM fills WHERE 1=1"
    params: list = []
    idx = 1

    if exchange:
        query += f" AND exchange = ${idx}"
        params.append(exchange)
        idx += 1
    if symbol:
        query += f" AND symbol = ${idx}"
        params.append(symbol)
        idx += 1

    query += f" ORDER BY ts DESC LIMIT ${idx}"
    params.append(limit)

    async with db_pool.acquire() as conn:
        rows = await conn.fetch(query, *params)

    return [dict(row) for row in rows]


@app.post("/api/order")
async def submit_order(order: dict):
    """
    Submit a manual order — forwards to Trading Node via Redis.

    Body: {exchange, symbol, side, type, quantity, price?}
    """
    await redis_client.publish(Channels.CMD_ORDER, json.dumps(order))
    return {"status": "submitted", "order": order}


@app.post("/api/order/cancel")
async def cancel_order(cancel: dict):
    """Cancel an open order via Trading Node."""
    await redis_client.publish(Channels.CMD_CANCEL, json.dumps(cancel))
    return {"status": "cancel_submitted"}


@app.post("/api/backfill")
async def trigger_backfill(req: dict):
    """Trigger Data Worker to backfill historical data."""
    await redis_client.publish("cmd:backfill", json.dumps(req))
    return {"status": "backfill_triggered"}


@app.get("/api/exchanges")
async def list_exchanges():
    """Return supported exchanges and their types."""
    return [
        {"id": "binance_spot", "name": "Binance Spot", "type": "spot"},
        {"id": "binance_futures", "name": "Binance Futures", "type": "futures"},
        {"id": "hyperliquid", "name": "Hyperliquid", "type": "futures"},
    ]


# ═══════════════════════════════════════════════════════════
# WEBSOCKET — Real-time data relay
# ═══════════════════════════════════════════════════════════

class ConnectionManager:
    """Manages active WebSocket connections and their subscriptions."""

    def __init__(self):
        self.active: dict[WebSocket, set[str]] = {}

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active[ws] = set()

    def disconnect(self, ws: WebSocket):
        self.active.pop(ws, None)

    async def subscribe(self, ws: WebSocket, channels: list[str]):
        if ws in self.active:
            self.active[ws].update(channels)

    async def unsubscribe(self, ws: WebSocket, channels: list[str]):
        if ws in self.active:
            self.active[ws].difference_update(channels)

    def get_subscribers(self, channel: str) -> list[WebSocket]:
        return [ws for ws, chans in self.active.items() if channel in chans]


manager = ConnectionManager()


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    """
    WebSocket endpoint for real-time data streaming.

    Client sends JSON commands:
      {"action": "subscribe", "channels": ["kline:binance_spot:BTCUSDT", "fill:binance_spot:BTCUSDT"]}
      {"action": "unsubscribe", "channels": ["kline:binance_spot:BTCUSDT"]}

    Server pushes:
      {"channel": "kline:binance_spot:BTCUSDT", "data": {...}}
      {"channel": "fill:binance_spot:BTCUSDT", "data": {...}}
    """
    await manager.connect(ws)
    logger.info("WebSocket client connected")

    try:
        # Start Redis subscriber relay in background
        relay_task = asyncio.create_task(_redis_relay(ws))

        # Listen for client commands
        while True:
            raw = await ws.receive_text()
            msg = json.loads(raw)
            action = msg.get("action")

            if action == "subscribe":
                channels = msg.get("channels", [])
                await manager.subscribe(ws, channels)
                logger.info(f"Client subscribed to: {channels}")

            elif action == "unsubscribe":
                channels = msg.get("channels", [])
                await manager.unsubscribe(ws, channels)

    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    finally:
        relay_task.cancel()
        manager.disconnect(ws)


async def _redis_relay(ws: WebSocket):
    """
    Subscribe to all relevant Redis channels and relay messages
    to this specific WebSocket client.
    """
    rds = create_redis()
    pubsub = rds.pubsub()

    # Subscribe to all kline and fill channels via pattern
    await pubsub.psubscribe("kline:*", "fill:*")

    try:
        async for msg in pubsub.listen():
            if msg["type"] not in ("pmessage",):
                continue

            channel = msg["channel"]
            # Only send if this client is subscribed to this channel
            if ws in manager.active and channel in manager.active[ws]:
                try:
                    await ws.send_json({
                        "channel": channel,
                        "data": json.loads(msg["data"]),
                    })
                except Exception:
                    break
    finally:
        await pubsub.unsubscribe()
        await rds.close()
