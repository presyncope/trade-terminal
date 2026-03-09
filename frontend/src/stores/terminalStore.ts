/**
 * Terminal Store — Central state management with Zustand.
 *
 * Manages:
 *   - Chart grid layout (add/remove/resize charts)
 *   - Per-chart configuration (exchange, symbol, interval)
 *   - Fill history
 *   - WebSocket connection state
 */

import { create } from "zustand";
import type { ChartConfig, ExchangeId, Fill, LayoutItem } from "../types";

let chartCounter = 0;

function makeChartId(): string {
  return `chart-${++chartCounter}`;
}

interface TerminalState {
  // ─── Charts ──────────────────────────────────────
  charts: ChartConfig[];
  layout: LayoutItem[];
  addChart: (exchange?: ExchangeId, symbol?: string) => void;
  removeChart: (id: string) => void;
  updateChart: (id: string, updates: Partial<ChartConfig>) => void;
  updateLayout: (layout: LayoutItem[]) => void;

  // ─── Fills ───────────────────────────────────────
  fills: Fill[];
  addFill: (fill: Fill) => void;

  // ─── Connection ──────────────────────────────────
  wsConnected: boolean;
  setWsConnected: (connected: boolean) => void;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  // ─── Charts ──────────────────────────────────────
  charts: [
    { id: "chart-1", exchange: "binance_spot", symbol: "BTCUSDT", interval: "1m" },
  ],
  layout: [
    { i: "chart-1", x: 0, y: 0, w: 6, h: 4 },
  ],

  addChart: (exchange = "binance_spot", symbol = "ETHUSDT") => {
    const id = makeChartId();
    const { charts, layout } = get();
    // Place new chart to the right or below
    const maxY = layout.reduce((max, l) => Math.max(max, l.y + l.h), 0);
    set({
      charts: [...charts, { id, exchange, symbol, interval: "1m" }],
      layout: [...layout, { i: id, x: 0, y: maxY, w: 6, h: 4 }],
    });
  },

  removeChart: (id) => set((s) => ({
    charts: s.charts.filter((c) => c.id !== id),
    layout: s.layout.filter((l) => l.i !== id),
  })),

  updateChart: (id, updates) => set((s) => ({
    charts: s.charts.map((c) => (c.id === id ? { ...c, ...updates } : c)),
  })),

  updateLayout: (layout) => set({ layout }),

  // ─── Fills ───────────────────────────────────────
  fills: [],
  addFill: (fill) => set((s) => ({
    fills: [fill, ...s.fills].slice(0, 500), // keep last 500
  })),

  // ─── Connection ──────────────────────────────────
  wsConnected: false,
  setWsConnected: (connected) => set({ wsConnected: connected }),
}));

// Initialize counter from existing charts
chartCounter = 1;
