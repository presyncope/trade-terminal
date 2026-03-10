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
from datetime import datetime, timezone, timedelta

import asyncpg
import redis.asyncio as aioredis
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware

import sys
sys.path.insert(0, "/app")
from services.shared.config import TimescaleConfig, RedisConfig, Channels
from services.shared.db import create_pool
from services.shared.redis_client import create_redis
from services.web_api.binance_client import BinanceAccountClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")
logger = logging.getLogger("web-api")

# ─── App State ────────────────────────────────────────────
db_pool: asyncpg.Pool | None = None
redis_client: aioredis.Redis | None = None
binance_account: BinanceAccountClient | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global db_pool, redis_client, binance_account
    db_pool = await create_pool()
    redis_client = create_redis()
    binance_account = BinanceAccountClient()
    await binance_account.initialize()
    logger.info("Web API started — DB pool and Redis connected")
    yield
    await db_pool.close()
    await redis_client.close()
    await binance_account.close()
    logger.info("Web API stopped")


app = FastAPI(title="IRH Trading Terminal API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Timeframe config ─────────────────────────────────────
# Non-1m intervals use inline time_bucket() on the raw klines table rather
# than querying the continuous aggregate views, because the views start empty
# (WITH NO DATA) and only populate after their scheduled refresh runs.
INTERVAL_BUCKET = {
    "1m":  None,           # direct row query — no bucketing
    "5m":  "5 minutes",
    "15m": "15 minutes",
    "1h":  "1 hour",
    "4h":  "4 hours",
    "1d":  "1 day",
}

INTERVAL_SECONDS = {
    "1m":  60,
    "5m":  300,
    "15m": 900,
    "1h":  3_600,
    "4h":  14_400,
    "1d":  86_400,
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

    1m  — queries the raw klines hypertable directly.
    5m+ — queries klines_native (natively fetched at the target interval).
          Falls back to inline time_bucket() on klines if native data is absent
          (covers the initial 3-day window before the first native backfill runs).

    Always returns the MOST RECENT `limit` candles, ordered ascending.
    Triggers a backfill (at the same interval) when data is missing.
    """
    interval_secs = INTERVAL_SECONDS.get(interval, 60)
    params: list = [exchange, symbol]
    idx = 3

    where_base = "exchange = $1 AND symbol = $2"
    if start:
        where_base += f" AND ts >= ${idx}"
        params.append(start)
        idx += 1
    if end:
        where_base += f" AND ts <= ${idx}"
        params.append(end)
        idx += 1

    if interval == "1m":
        # 1m: direct query on raw hypertable
        inner = f"""
            SELECT ts, open, high, low, close, volume
            FROM klines
            WHERE {where_base}
            ORDER BY ts DESC
            LIMIT ${idx}
        """
    else:
        # Non-1m: prefer natively stored candles in klines_native …
        native_where = where_base + f" AND interval = '{interval}'"
        inner = f"""
            SELECT ts, open, high, low, close, volume
            FROM klines_native
            WHERE {native_where}
            ORDER BY ts DESC
            LIMIT ${idx}
        """

    params.append(limit)
    query = f"SELECT * FROM ({inner}) sub ORDER BY ts ASC"

    async with db_pool.acquire() as conn:
        rows = await conn.fetch(query, *params)

    # ── Cache-miss detection: trigger interval-native backfill if data is sparse ──
    backfill_triggered = False
    now = datetime.now(timezone.utc)

    async def _publish_backfill(bf_start: datetime, bf_end: datetime):
        await redis_client.publish("cmd:backfill", json.dumps({
            "exchange": exchange,
            "symbol":   symbol,
            "interval": interval,
            "start":    bf_start.isoformat(),
            "end":      bf_end.isoformat(),
        }))
        logger.info(f"Triggered {interval} backfill for {exchange}:{symbol} [{bf_start} → {bf_end}]")

    if end:
        # Historical scroll: if fewer than 50% of expected candles exist, backfill that window
        if len(rows) < limit * 0.5:
            bf_start = end - timedelta(seconds=limit * interval_secs)
            await _publish_backfill(bf_start, end)
            backfill_triggered = True
    else:
        # Initial load: backfill if empty or newest candle is stale.
        # Threshold = 3 intervals (min 5 minutes) so short-interval charts
        # trigger backfill aggressively instead of waiting up to 1 hour.
        stale_threshold_secs = max(3 * interval_secs, 300)  # at least 5 min
        newest_age_secs = None
        if rows:
            newest_ts = rows[-1]["ts"]
            if newest_ts.tzinfo is None:
                newest_ts = newest_ts.replace(tzinfo=timezone.utc)
            newest_age_secs = (now - newest_ts).total_seconds()

        if not rows or newest_age_secs > stale_threshold_secs:
            bf_end   = now
            # Cover enough history to fill the chart (limit candles worth)
            bf_start = now - timedelta(seconds=limit * interval_secs)
            await _publish_backfill(bf_start, bf_end)
            backfill_triggered = True

    data = [
        {
            "time": int(row["ts"].timestamp()),
            "open": float(row["open"]),
            "high": float(row["high"]),
            "low": float(row["low"]),
            "close": float(row["close"]),
            "volume": float(row["volume"]),
        }
        for row in rows
    ]
    return {"data": data, "backfill_triggered": backfill_triggered}


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


@app.get("/api/open-orders")
async def get_open_orders(
    exchange: str = Query(...),
    symbol: str | None = Query(None),
):
    """Return open orders from the exchange. Currently supports binance_spot."""
    if exchange == "binance_spot":
        return await binance_account.get_open_orders(symbol)
    return []


@app.get("/api/balance")
async def get_balance(exchange: str = Query(...)):
    """Return non-zero account balances. Currently supports binance_spot."""
    if exchange == "binance_spot":
        return await binance_account.get_account_balances()
    return []


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

    # Subscribe to all kline, fill, and backfill completion channels via pattern
    await pubsub.psubscribe("kline:*", "fill:*", "backfill:done:*")

    try:
        async for msg in pubsub.listen():
            if msg["type"] not in ("pmessage",):
                continue

            channel = msg["channel"]
            # Fill events are always broadcast to all connected clients so
            # the account panel receives them without explicit subscription.
            # Kline / backfill events only go to subscribed clients.
            if channel.startswith("fill:"):
                try:
                    await ws.send_json({
                        "channel": channel,
                        "data": json.loads(msg["data"]),
                    })
                except Exception:
                    break
            elif ws in manager.active and channel in manager.active[ws]:
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
