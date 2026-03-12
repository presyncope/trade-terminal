import React, { useState } from "react";
import { triggerExperiment, type ExperimentRequest } from "../../api/experiment";

type Mode = "single" | "optimize";

const EXCHANGES = [
  { id: "binance_spot",    label: "Binance Spot"    },
  { id: "binance_futures", label: "Binance Futures" },
];

const STRATEGIES = [
  { id: "sma_crossover", label: "SMA Crossover" },
];

export function BacktestConfig() {
  const [strategy, setStrategy]   = useState("sma_crossover");
  const [exchange, setExchange]   = useState("binance_spot");
  const [symbol, setSymbol]       = useState("BTCUSDT");
  const [start, setStart]         = useState("2024-01-01");
  const [end, setEnd]             = useState("2025-01-01");
  const [mode, setMode]           = useState<Mode>("single");

  // single mode params
  const [fastPeriod, setFastPeriod] = useState(10);
  const [slowPeriod, setSlowPeriod] = useState(30);
  const [quantity, setQuantity]     = useState(0.001);

  // optimize mode params
  const [maxEvals, setMaxEvals] = useState(50);

  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage]       = useState<{ text: string; ok: boolean } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);

    const req: ExperimentRequest = {
      strategy_id: strategy,
      exchange,
      symbol: symbol.toUpperCase(),
      start:  `${start}T00:00:00Z`,
      end:    `${end}T00:00:00Z`,
      mode,
      ...(mode === "single"
        ? { params: { fast_period: fastPeriod, slow_period: slowPeriod, quantity } }
        : { max_evals: maxEvals }),
    };

    try {
      await triggerExperiment(req);
      setMessage({
        text: mode === "optimize"
          ? `Optimization queued (${maxEvals} trials). Results will appear in the leaderboard when complete.`
          : "Backtest queued. Result will appear in the leaderboard shortly.",
        ok: true,
      });
    } catch (err: any) {
      setMessage({ text: err.message, ok: false });
    } finally {
      setSubmitting(false);
    }
  };

  const s = styles;

  return (
    <div style={s.root}>
      <div style={s.header}>Run Experiment</div>

      <form onSubmit={handleSubmit} style={s.form}>
        {/* Strategy */}
        <Field label="Strategy">
          <select value={strategy} onChange={(e) => setStrategy(e.target.value)} style={s.input}>
            {STRATEGIES.map((st) => (
              <option key={st.id} value={st.id}>{st.label}</option>
            ))}
          </select>
        </Field>

        {/* Exchange + Symbol */}
        <Field label="Exchange">
          <select value={exchange} onChange={(e) => setExchange(e.target.value)} style={s.input}>
            {EXCHANGES.map((ex) => (
              <option key={ex.id} value={ex.id}>{ex.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Symbol">
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            style={s.input}
            placeholder="BTCUSDT"
            required
          />
        </Field>

        {/* Date range */}
        <Field label="Start Date">
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            style={s.input}
            required
          />
        </Field>

        <Field label="End Date">
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            style={s.input}
            required
          />
        </Field>

        {/* Mode toggle */}
        <Field label="Mode">
          <div style={s.modeToggle}>
            <button
              type="button"
              onClick={() => setMode("single")}
              style={{ ...s.modeBtn, ...(mode === "single" ? s.modeBtnActive : {}) }}
            >
              Single
            </button>
            <button
              type="button"
              onClick={() => setMode("optimize")}
              style={{ ...s.modeBtn, ...(mode === "optimize" ? s.modeBtnActive : {}) }}
            >
              Hyperopt
            </button>
          </div>
        </Field>

        <div style={s.divider} />

        {/* Mode-specific params */}
        {mode === "single" ? (
          <>
            <div style={s.sectionLabel}>Parameters (SMA Crossover)</div>
            <Field label="Fast Period">
              <input
                type="number"
                value={fastPeriod}
                onChange={(e) => setFastPeriod(Number(e.target.value))}
                style={s.input}
                min={2}
                max={200}
              />
            </Field>
            <Field label="Slow Period">
              <input
                type="number"
                value={slowPeriod}
                onChange={(e) => setSlowPeriod(Number(e.target.value))}
                style={s.input}
                min={2}
                max={500}
              />
            </Field>
            <Field label="Quantity">
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                style={s.input}
                step={0.001}
                min={0.0001}
              />
            </Field>
          </>
        ) : (
          <>
            <div style={s.sectionLabel}>Hyperopt Configuration</div>
            <Field label="Max Trials">
              <input
                type="number"
                value={maxEvals}
                onChange={(e) => setMaxEvals(Number(e.target.value))}
                style={s.input}
                min={10}
                max={500}
              />
            </Field>
            <div style={s.hint}>
              TPE algorithm searches over fast [5–50], slow [20–200], quantity [0.001/0.01/0.1].<br />
              Objective: maximise Sharpe ratio.
            </div>
          </>
        )}

        <div style={s.divider} />

        <button type="submit" style={s.submitBtn} disabled={submitting}>
          {submitting
            ? "Queuing…"
            : mode === "optimize"
              ? `Run Hyperopt (${maxEvals} trials)`
              : "Run Backtest"}
        </button>

        {message && (
          <div style={{ ...s.message, color: message.ok ? "#26a69a" : "#ef5350" }}>
            {message.text}
          </div>
        )}
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={fieldStyles.row}>
      <label style={fieldStyles.label}>{label}</label>
      <div style={fieldStyles.control}>{children}</div>
    </div>
  );
}

const fieldStyles = {
  row: {
    display: "flex" as const,
    alignItems: "center" as const,
    gap: 8,
    marginBottom: 8,
  },
  label: {
    width: 90,
    fontSize: 11,
    color: "#787b86",
    flexShrink: 0,
    textAlign: "right" as const,
  },
  control: {
    flex: 1,
  },
};

const styles = {
  root: {
    height: "100%",
    display: "flex" as const,
    flexDirection: "column" as const,
    borderRight: "1px solid #2a2e39",
    width: 320,
    flexShrink: 0,
  },
  header: {
    height: 36,
    display: "flex" as const,
    alignItems: "center" as const,
    padding: "0 16px",
    borderBottom: "1px solid #2a2e39",
    fontWeight: 600,
    fontSize: 12,
    color: "#d1d4dc",
    background: "#1e222d",
  },
  form: {
    padding: 16,
    overflowY: "auto" as const,
    flex: 1,
  },
  input: {
    width: "100%",
    background: "#131722",
    color: "#d1d4dc",
    border: "1px solid #2a2e39",
    borderRadius: 3,
    padding: "4px 8px",
    fontSize: 12,
    boxSizing: "border-box" as const,
  },
  modeToggle: {
    display: "flex" as const,
    gap: 4,
  },
  modeBtn: {
    flex: 1,
    background: "transparent",
    color: "#787b86",
    border: "1px solid #2a2e39",
    borderRadius: 3,
    padding: "4px 0",
    cursor: "pointer",
    fontSize: 12,
  },
  modeBtnActive: {
    background: "#2a2e39",
    color: "#d1d4dc",
    borderColor: "#4a4e5a",
  },
  divider: {
    borderTop: "1px solid #2a2e39",
    margin: "12px 0",
  },
  sectionLabel: {
    fontSize: 10,
    color: "#555",
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    marginBottom: 10,
  },
  hint: {
    fontSize: 10,
    color: "#555",
    lineHeight: 1.5,
    marginTop: 4,
  },
  submitBtn: {
    width: "100%",
    background: "#2962ff",
    color: "#fff",
    border: "none",
    borderRadius: 4,
    padding: "8px 0",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
  },
  message: {
    marginTop: 10,
    fontSize: 11,
    lineHeight: 1.5,
  },
};
