-- ============================================================
-- backtest_runs — stores results of every strategy experiment
-- ============================================================

CREATE TABLE IF NOT EXISTS backtest_runs (
    id              BIGSERIAL        PRIMARY KEY,
    created_at      TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    strategy_id     TEXT             NOT NULL,
    exchange        TEXT             NOT NULL,
    symbol          TEXT             NOT NULL,
    interval        TEXT             NOT NULL DEFAULT '1m',
    start_ts        TIMESTAMPTZ      NOT NULL,
    end_ts          TIMESTAMPTZ      NOT NULL,

    -- Strategy parameters (JSON blob — schema varies per strategy)
    params          JSONB            NOT NULL DEFAULT '{}',

    -- Performance metrics
    total_return    DOUBLE PRECISION NOT NULL DEFAULT 0,
    sharpe_ratio    DOUBLE PRECISION NOT NULL DEFAULT 0,
    max_drawdown    DOUBLE PRECISION NOT NULL DEFAULT 0,
    win_rate        DOUBLE PRECISION NOT NULL DEFAULT 0,
    total_trades    INTEGER          NOT NULL DEFAULT 0,
    profit_factor   DOUBLE PRECISION NOT NULL DEFAULT 0,
    avg_trade_pnl   DOUBLE PRECISION NOT NULL DEFAULT 0,

    -- MLflow tracking reference
    mlflow_run_id   TEXT,

    -- Run mode: 'single' | 'optimize'
    mode            TEXT             NOT NULL DEFAULT 'single'
);

-- Leaderboard primary access pattern: rank by Sharpe within strategy+market
CREATE INDEX IF NOT EXISTS idx_backtest_runs_strategy_sharpe
    ON backtest_runs (strategy_id, exchange, symbol, sharpe_ratio DESC);

CREATE INDEX IF NOT EXISTS idx_backtest_runs_created
    ON backtest_runs (created_at DESC);
