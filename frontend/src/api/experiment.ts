const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export interface BacktestRun {
  id: number;
  created_at: string;
  strategy_id: string;
  exchange: string;
  symbol: string;
  interval: string;
  params: Record<string, number | string>;
  total_return: number;
  sharpe_ratio: number;
  max_drawdown: number;
  win_rate: number;
  total_trades: number;
  profit_factor: number;
  avg_trade_pnl: number;
  mlflow_run_id: string | null;
  mode: "single" | "optimize";
}

export interface ExperimentRequest {
  strategy_id: string;
  exchange: string;
  symbol: string;
  start: string;
  end: string;
  interval?: string;
  mode: "single" | "optimize";
  params?: Record<string, number>;
  max_evals?: number;
}

export async function fetchLeaderboard(filters?: {
  strategy_id?: string;
  exchange?: string;
  symbol?: string;
  limit?: number;
}): Promise<BacktestRun[]> {
  const p = new URLSearchParams();
  if (filters?.strategy_id) p.set("strategy_id", filters.strategy_id);
  if (filters?.exchange)     p.set("exchange",     filters.exchange);
  if (filters?.symbol)       p.set("symbol",       filters.symbol);
  if (filters?.limit)        p.set("limit",        String(filters.limit));
  const resp = await fetch(`${API_URL}/api/leaderboard?${p}`);
  if (!resp.ok) throw new Error(`Leaderboard fetch failed: ${resp.statusText}`);
  return resp.json();
}

export async function triggerExperiment(
  req: ExperimentRequest,
): Promise<{ status: string }> {
  const resp = await fetch(`${API_URL}/api/experiment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!resp.ok) throw new Error(`Experiment trigger failed: ${resp.statusText}`);
  return resp.json();
}
