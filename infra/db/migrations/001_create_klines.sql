-- ============================================================
-- TimescaleDB Schema: Kline (Candlestick / Bar) Data
-- ============================================================

-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ─── 1. Base Kline Table ─────────────────────────────────
-- Stores 1-minute candles as the base resolution.
-- Higher timeframes are derived via Continuous Aggregates.
CREATE TABLE IF NOT EXISTS klines (
    ts          TIMESTAMPTZ     NOT NULL,   -- candle open time (UTC)
    exchange    TEXT            NOT NULL,   -- 'binance_spot', 'binance_futures', 'hyperliquid'
    symbol      TEXT            NOT NULL,   -- 'BTCUSDT', 'ETHUSDT', ...
    open        DOUBLE PRECISION NOT NULL,
    high        DOUBLE PRECISION NOT NULL,
    low         DOUBLE PRECISION NOT NULL,
    close       DOUBLE PRECISION NOT NULL,
    volume      DOUBLE PRECISION NOT NULL,
    turnover    DOUBLE PRECISION NOT NULL DEFAULT 0,  -- quote volume
    trade_count INTEGER         NOT NULL DEFAULT 0
);

-- Convert to hypertable partitioned by time (1-day chunks for 1m candles)
SELECT create_hypertable(
    'klines', 'ts',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- ─── 2. Indexes ──────────────────────────────────────────
-- Primary lookup pattern: exchange + symbol + time range
CREATE UNIQUE INDEX IF NOT EXISTS idx_klines_exch_sym_ts
    ON klines (exchange, symbol, ts DESC);

-- Fast symbol listing per exchange
CREATE INDEX IF NOT EXISTS idx_klines_exchange
    ON klines (exchange);

-- ─── 3. Compression Policy (for old data) ────────────────
ALTER TABLE klines SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'exchange, symbol',
    timescaledb.compress_orderby = 'ts DESC'
);

-- Auto-compress chunks older than 7 days
SELECT add_compression_policy('klines', INTERVAL '7 days', if_not_exists => TRUE);

-- ─── 4. Retention Policy (optional, adjust as needed) ────
-- Keep raw 1m data for 1 year
-- SELECT add_retention_policy('klines', INTERVAL '1 year', if_not_exists => TRUE);

-- ─── 5. Continuous Aggregates (higher timeframes) ────────
-- 5-minute candles
CREATE MATERIALIZED VIEW IF NOT EXISTS klines_5m
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('5 minutes', ts) AS ts,
    exchange,
    symbol,
    first(open, ts)   AS open,
    max(high)          AS high,
    min(low)           AS low,
    last(close, ts)    AS close,
    sum(volume)        AS volume,
    sum(turnover)      AS turnover,
    sum(trade_count)   AS trade_count
FROM klines
GROUP BY time_bucket('5 minutes', ts), exchange, symbol
WITH NO DATA;

-- 15-minute candles
CREATE MATERIALIZED VIEW IF NOT EXISTS klines_15m
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('15 minutes', ts) AS ts,
    exchange,
    symbol,
    first(open, ts)   AS open,
    max(high)          AS high,
    min(low)           AS low,
    last(close, ts)    AS close,
    sum(volume)        AS volume,
    sum(turnover)      AS turnover,
    sum(trade_count)   AS trade_count
FROM klines
GROUP BY time_bucket('15 minutes', ts), exchange, symbol
WITH NO DATA;

-- 1-hour candles
CREATE MATERIALIZED VIEW IF NOT EXISTS klines_1h
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', ts) AS ts,
    exchange,
    symbol,
    first(open, ts)   AS open,
    max(high)          AS high,
    min(low)           AS low,
    last(close, ts)    AS close,
    sum(volume)        AS volume,
    sum(turnover)      AS turnover,
    sum(trade_count)   AS trade_count
FROM klines
GROUP BY time_bucket('1 hour', ts), exchange, symbol
WITH NO DATA;

-- 4-hour candles
CREATE MATERIALIZED VIEW IF NOT EXISTS klines_4h
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('4 hours', ts) AS ts,
    exchange,
    symbol,
    first(open, ts)   AS open,
    max(high)          AS high,
    min(low)           AS low,
    last(close, ts)    AS close,
    sum(volume)        AS volume,
    sum(turnover)      AS turnover,
    sum(trade_count)   AS trade_count
FROM klines
GROUP BY time_bucket('4 hours', ts), exchange, symbol
WITH NO DATA;

-- 1-day candles
CREATE MATERIALIZED VIEW IF NOT EXISTS klines_1d
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', ts) AS ts,
    exchange,
    symbol,
    first(open, ts)   AS open,
    max(high)          AS high,
    min(low)           AS low,
    last(close, ts)    AS close,
    sum(volume)        AS volume,
    sum(turnover)      AS turnover,
    sum(trade_count)   AS trade_count
FROM klines
GROUP BY time_bucket('1 day', ts), exchange, symbol
WITH NO DATA;

-- ─── 6. Refresh Policies for Continuous Aggregates ───────
SELECT add_continuous_aggregate_policy('klines_5m',
    start_offset    => INTERVAL '1 hour',
    end_offset      => INTERVAL '5 minutes',
    schedule_interval => INTERVAL '5 minutes',
    if_not_exists   => TRUE
);

SELECT add_continuous_aggregate_policy('klines_15m',
    start_offset    => INTERVAL '2 hours',
    end_offset      => INTERVAL '15 minutes',
    schedule_interval => INTERVAL '15 minutes',
    if_not_exists   => TRUE
);

SELECT add_continuous_aggregate_policy('klines_1h',
    start_offset    => INTERVAL '6 hours',
    end_offset      => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists   => TRUE
);

SELECT add_continuous_aggregate_policy('klines_4h',
    start_offset    => INTERVAL '1 day',
    end_offset      => INTERVAL '4 hours',
    schedule_interval => INTERVAL '4 hours',
    if_not_exists   => TRUE
);

SELECT add_continuous_aggregate_policy('klines_1d',
    start_offset    => INTERVAL '3 days',
    end_offset      => INTERVAL '1 day',
    schedule_interval => INTERVAL '1 day',
    if_not_exists   => TRUE
);

-- ─── 7. Fills / Trade History Table ──────────────────────
CREATE TABLE IF NOT EXISTS fills (
    id              BIGSERIAL,
    ts              TIMESTAMPTZ     NOT NULL,
    exchange        TEXT            NOT NULL,
    symbol          TEXT            NOT NULL,
    side            TEXT            NOT NULL,  -- 'BUY' | 'SELL'
    price           DOUBLE PRECISION NOT NULL,
    quantity        DOUBLE PRECISION NOT NULL,
    commission      DOUBLE PRECISION NOT NULL DEFAULT 0,
    order_id        TEXT,
    strategy_id     TEXT,
    is_manual       BOOLEAN         NOT NULL DEFAULT FALSE
);

SELECT create_hypertable(
    'fills', 'ts',
    chunk_time_interval => INTERVAL '1 month',
    if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS idx_fills_exch_sym_ts
    ON fills (exchange, symbol, ts DESC);
