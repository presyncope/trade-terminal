import React, { useState, useEffect, useCallback } from "react";
import {
  fetchLeaderboard,
  triggerExperiment,
  type BacktestRun,
} from "../../api/experiment";

const MLFLOW_URL = import.meta.env.VITE_MLFLOW_URL || "http://localhost:5000";

const EXCHANGES = [
  { id: "binance_spot",    label: "Binance Spot"    },
  { id: "binance_futures", label: "Binance Futures" },
];

export function StrategyLeaderboard() {
  const [runs, setRuns]               = useState<BacktestRun[]>([]);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [exchange, setExchange]       = useState("binance_spot");
  const [symbol, setSymbol]           = useState("BTCUSDT");
  const [submitting, setSubmitting]   = useState(false);
  const [submitMsg, setSubmitMsg]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchLeaderboard({ exchange, symbol, limit: 50 });
      setRuns(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [exchange, symbol]);

  useEffect(() => {
    load();
  }, [load]);

  const handleOptimize = async () => {
    setSubmitting(true);
    setSubmitMsg(null);
    setError(null);
    try {
      await triggerExperiment({
        strategy_id: "sma_crossover",
        exchange,
        symbol,
        start:     "2024-01-01T00:00:00Z",
        end:       "2025-01-01T00:00:00Z",
        mode:      "optimize",
        max_evals: 50,
      });
      setSubmitMsg("Optimization queued — results will appear when complete.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSingle = async () => {
    setSubmitting(true);
    setSubmitMsg(null);
    setError(null);
    try {
      await triggerExperiment({
        strategy_id: "sma_crossover",
        exchange,
        symbol,
        start:  "2024-01-01T00:00:00Z",
        end:    "2025-01-01T00:00:00Z",
        mode:   "single",
        params: { fast_period: 10, slow_period: 30, quantity: 0.001 },
      });
      setSubmitMsg("Backtest queued.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const s = styles;

  return (
    <div style={s.root}>
      <div style={s.header}>
        <span style={s.title}>Strategy Leaderboard</span>
        <select
          value={exchange}
          onChange={(e) => setExchange(e.target.value)}
          style={s.select}
        >
          {EXCHANGES.map((ex) => (
            <option key={ex.id} value={ex.id}>{ex.label}</option>
          ))}
        </select>
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          style={s.input}
          placeholder="BTCUSDT"
        />
        <button onClick={load} style={s.btn} disabled={loading}>
          {loading ? "…" : "Refresh"}
        </button>
        <button
          onClick={handleSingle}
          style={s.btn}
          disabled={submitting}
          title="Run single backtest with default SMA(10,30) params"
        >
          Run Single
        </button>
        <button
          onClick={handleOptimize}
          style={{ ...s.btn, ...s.btnPrimary }}
          disabled={submitting}
          title="Run 50-trial Hyperopt search to find best SMA parameters"
        >
          {submitting ? "Queued…" : "Run Optimize"}
        </button>
      </div>

      {submitMsg && <div style={s.info}>{submitMsg}</div>}
      {error     && <div style={s.error}>{error}</div>}

      <div style={s.body}>
        <table style={s.table}>
          <thead>
            <tr>
              {["#", "Strategy", "Exchange", "Symbol", "Sharpe", "Return", "Drawdown", "Win%", "Trades", "PF", "Params", "Mode", "Date", "MLflow"].map((h) => (
                <th key={h} style={s.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 && !loading ? (
              <tr>
                <td colSpan={14} style={{ ...s.td, textAlign: "center", color: "#555" }}>
                  No backtest runs yet — click Run Single or Run Optimize to start
                </td>
              </tr>
            ) : (
              runs.map((run, i) => (
                <tr key={run.id}>
                  <td style={{ ...s.td, color: "#555" }}>{i + 1}</td>
                  <td style={{ ...s.td, fontWeight: 600, color: "#d1d4dc" }}>{run.strategy_id}</td>
                  <td style={s.td}>{run.exchange}</td>
                  <td style={s.td}>{run.symbol}</td>
                  <td style={{ ...s.td, color: sharpeColor(run.sharpe_ratio), fontWeight: 600 }}>
                    {run.sharpe_ratio.toFixed(3)}
                  </td>
                  <td style={{ ...s.td, color: run.total_return >= 0 ? "#26a69a" : "#ef5350" }}>
                    {(run.total_return * 100).toFixed(2)}%
                  </td>
                  <td style={{ ...s.td, color: "#ef5350" }}>
                    {(run.max_drawdown * 100).toFixed(2)}%
                  </td>
                  <td style={s.td}>{(run.win_rate * 100).toFixed(1)}%</td>
                  <td style={s.td}>{run.total_trades}</td>
                  <td style={s.td}>
                    {run.profit_factor >= 9999 ? "∞" : run.profit_factor.toFixed(2)}
                  </td>
                  <td style={{ ...s.td, fontFamily: "monospace", fontSize: 9, color: "#787b86" }}>
                    {Object.entries(run.params)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(" ")}
                  </td>
                  <td style={{ ...s.td, color: run.mode === "optimize" ? "#f0b90b" : "#787b86" }}>
                    {run.mode}
                  </td>
                  <td style={{ ...s.td, color: "#555", fontSize: 9 }}>
                    {new Date(run.created_at).toLocaleDateString()}
                  </td>
                  <td style={s.td}>
                    {run.mlflow_run_id ? (
                      <a
                        href={`${MLFLOW_URL}/#/runs/${run.mlflow_run_id}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "#2962ff", fontSize: 10 }}
                      >
                        view
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function sharpeColor(v: number): string {
  if (v >= 1.5) return "#26a69a";
  if (v >= 0.5) return "#d1d4dc";
  if (v < 0)    return "#ef5350";
  return "#787b86";
}

const styles = {
  root: {
    height: "100%",
    display: "flex" as const,
    flexDirection: "column" as const,
    fontSize: 11,
  },
  header: {
    display: "flex" as const,
    alignItems: "center" as const,
    gap: 6,
    padding: "0 8px",
    height: 32,
    borderBottom: "1px solid #2a2e39",
    flexShrink: 0,
    flexWrap: "wrap" as const,
  },
  title: {
    fontWeight: 600,
    color: "#d1d4dc",
    marginRight: 4,
  },
  body: {
    flex: 1,
    overflow: "auto" as const,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
  },
  th: {
    padding: "4px 8px",
    textAlign: "left" as const,
    fontSize: 10,
    color: "#787b86",
    fontWeight: 500,
    borderBottom: "1px solid #2a2e39",
    position: "sticky" as const,
    top: 0,
    background: "#1e222d",
  },
  td: {
    padding: "3px 8px",
    fontSize: 11,
    borderBottom: "1px solid #1a1d27",
    color: "#c7c9d0",
  },
  select: {
    background: "#131722",
    color: "#d1d4dc",
    border: "1px solid #2a2e39",
    borderRadius: 3,
    padding: "2px 4px",
    fontSize: 11,
    cursor: "pointer",
  },
  input: {
    background: "#131722",
    color: "#d1d4dc",
    border: "1px solid #2a2e39",
    borderRadius: 3,
    padding: "2px 6px",
    fontSize: 11,
    width: 80,
  },
  btn: {
    background: "transparent",
    color: "#787b86",
    border: "1px solid #2a2e39",
    borderRadius: 3,
    padding: "2px 8px",
    cursor: "pointer",
    fontSize: 11,
  },
  btnPrimary: {
    background: "#2962ff",
    color: "#fff",
    border: "none",
  },
  info: {
    padding: "4px 8px",
    color: "#26a69a",
    fontSize: 10,
  },
  error: {
    padding: "4px 8px",
    color: "#ef5350",
    fontSize: 10,
  },
};
