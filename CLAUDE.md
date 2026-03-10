# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**IRH Terminal** (Intelligent Research Hub) — a live trading terminal with multi-chart views, real-time market data, and manual/automated order execution. Supports Binance (spot & futures) and Hyperliquid (futures, partially implemented).

## Commands

### Run the full stack
```bashdocker compose up --build
- Frontend: http://localhost:3000
- Web API: http://localhost:8000

### Run individual services
```bashdocker compose up timescaledb redis      # storage layer only
docker compose up web-api datastream     # backend without trading

### Frontend development (local, no Docker)
```bashcd frontend
npm install
npm run dev       # dev server at http://localhost:5173
npm run build     # TypeScript check + Vite build

### Trigger a historical data backfill (CLI mode)
```bashdocker compose exec data-worker python main.py backfill binance_spot BTCUSDT 2024-01-01 2024-06-01

### Environment setup
Copy `.env.example` to `.env` and fill in exchange API keys. `BINANCE_TESTNET=true` by default.

## Architecture

### Services (all in `services/`)

| Service | Path | Role |
|---|---|---|
| **DataStream** | `services/datastream/` | Subscribes to exchange WebSocket feeds, publishes normalized klines/ticks to Redis Pub/Sub |
| **Trading** | `services/trading/` | Listens for manual order commands from Redis, executes them via exchange APIs, publishes fill events back to Redis |
| **Data Worker** | `services/data-worker/` | Fetches historical klines from exchanges, bulk inserts into TimescaleDB; daemon mode listens on `cmd:backfill` Redis channel |
| **Web API** | `services/web-api/` | FastAPI BFF — serves historical data via REST from TimescaleDB, relays real-time data from Redis to frontend via WebSocket, routes order commands to Trading Node via Redis |
| **Frontend** | `frontend/` | React 19 + TypeScript + Vite; multi-chart terminal UI |

### Shared Python code
`services/shared/` contains `config.py` (env-based dataclasses), `db.py` (asyncpg pool), `redis_client.py`. All service Dockerfiles build from the repo root as context so they can import from `services/shared/`.

### Storage
- **TimescaleDB**: 1-minute klines hypertable (`klines`) as base; continuous aggregate views auto-derive `klines_5m`, `klines_15m`, `klines_1h`, `klines_4h`, `klines_1d`. Schema in `infra/db/migrations/001_create_klines.sql`.
- **Redis**: Sole message bus between all backend services and the frontend.

### Data flows

**Real-time data:**Exchange WS → DataStream → Redis(kline:, tick:) → Web API → Frontend WS

**Fill events:**Trading Node → Redis(fill:exchange:symbol) → Web API → Frontend WS → chart markers + TradeHistory table

**Manual orders:**Frontend → POST /api/order → Web API → Redis(cmd:order) → Trading Node → Exchange

**Historical data:**Frontend → GET /api/klines → Web API → TimescaleDB
(if missing) → POST /api/backfill → Redis(cmd:backfill) → Data Worker → TimescaleDB

### Redis Channel Namingkline:{exchange}:{symbol}   # real-time 1m candle updates
tick:{exchange}:{symbol}    # real-time tick data
fill:{exchange}:{symbol}    # trade fill events
cmd:order                   # manual order commands
cmd:cancel                  # cancel order commands
cmd:backfill                # historical data fetch requests
Helper: `services/shared/config.py` → `Channels` class.

### WebSocket Protocol (`/ws`)
Client sends:
```json{"action": "subscribe", "channels": ["kline:binance_spot:BTCUSDT"]}
{"action": "unsubscribe", "channels": ["kline:binance_spot:BTCUSDT"]}
Server pushes:
```json{"channel": "kline:binance_spot:BTCUSDT", "data": {...}}

### REST API (Web API on port 8000)
- `GET /api/klines?exchange=&symbol=&interval=1m&limit=500` — returns `[{time, open, high, low, close, volume}]`
- `GET /api/fills?exchange=&symbol=&limit=100`
- `GET /api/exchanges` — list of supported exchanges
- `POST /api/order` — `{exchange, symbol, side, type, quantity, price?}`
- `POST /api/order/cancel`
- `POST /api/backfill` — `{exchange, symbol, start, end}`

### Frontend State
Zustand store at `frontend/src/stores/terminalStore.ts` manages:
- `charts[]` — per-chart config (`{id, exchange, symbol, interval}`)
- `layout[]` — react-grid-layout positions
- `fills[]` — fill history (last 500)
- `wsConnected` — WebSocket connection status

WebSocket singleton managed in `frontend/src/hooks/useWebSocket.ts`. Kline updates bypass Zustand and use a module-level listener set (`klineListeners`) to avoid excessive re-renders; components subscribe via `onKlineUpdate()`.

### Exchange IDs
`"binance_spot"`, `"binance_futures"`, `"hyperliquid"` — used consistently across Redis channels, DB columns, and API parameters.

---

## NautilusTrader Reference

This project uses NautilusTrader as the framework for **automated strategy development** and **backtesting**.

**Official Docs:** https://nautilustrader.io/docs/latest/

When implementing or modifying any strategy or backtesting code, always consult the relevant NautilusTrader documentation section before writing code.

### Strategy Development

Primary reference pages (fetch and read before implementing):
- Concepts – Actor: https://nautilustrader.io/docs/latest/concepts/actor
- Concepts – Strategy: https://nautilustrader.io/docs/latest/concepts/strategy
- Concepts – Orders: https://nautilustrader.io/docs/latest/concepts/orders
- Concepts – Execution: https://nautilustrader.io/docs/latest/concepts/execution

Key rules:
- All strategies **must** subclass `nautilus_trader.trading.strategy.Strategy`
- Use `self.subscribe_bars()` / `self.subscribe_quote_ticks()` for data subscriptions — never poll directly
- Submit orders exclusively via `self.submit_order()` — do not call exchange APIs directly from strategy code
- Use `on_bar()`, `on_quote_tick()`, `on_order_filled()` event handlers; never use blocking calls inside handlers
- Indicators must be registered via `self.register_indicator_for_bars()` to stay in sync with the backtest clock

### Backtesting

Primary reference pages (fetch and read before implementing):
- Concepts – Backtesting: https://nautilustrader.io/docs/latest/concepts/backtesting
- Tutorials – Backtest (FX): https://nautilustrader.io/docs/latest/tutorials/backtest_fx_bars
- Tutorials – Backtest (crypto): https://nautilustrader.io/docs/latest/tutorials/backtest_crypto

Key rules:
- Load historical data from **TimescaleDB** (via `services/data-worker`) and convert kline rows to `nautilus_trader.model.data.Bar` objects before feeding to `BacktestEngine`
- IRH kline schema → NT Bar mapping: `time→ts_event`, `open/high/low/close→prices`, `volume→volume`; use `BarType` with `BarAggregation.MINUTE` for 1m data
- Configure `BacktestEngine` with `FillModel` and `CommissionModel` matching target exchange fee tiers
- Backtest results (fills, positions, P&L) must be exported and stored back into TimescaleDB for display in the IRH frontend

### Data Model Mapping (IRH ↔ NautilusTrader)

| IRH concept | NT equivalent | Notes |
|---|---|---|
| `exchange` string (`"binance_spot"`) | `Venue` | Map to `Venue("BINANCE")` |
| `symbol` string (`"BTCUSDT"`) | `InstrumentId` | e.g. `InstrumentId.from_str("BTCUSDT.BINANCE")` |
| kline row `{time, open, high, low, close, volume}` | `Bar` | Use `BarType` + `Bar` constructor |
| tick row | `QuoteTick` / `TradeTick` | Choose based on data availability |
| fill event on Redis | `OrderFilled` event | Publish NT fill events back to Redis after live execution |

### Workflow for New Strategy or Backtest

1. Read the relevant NT concept/tutorial page listed above
2. Implement strategy in `services/trading/strategies/` subclassing `Strategy`
3. Write a backtest script in `services/data-worker/backtests/` that loads data from TimescaleDB
4. Validate backtest fills match expected behavior before enabling live execution
5. For live execution, wire the strategy's `submit_order()` calls through the existing `cmd:order` Redis channel