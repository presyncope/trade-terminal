/**
 * ChartWidget — Individual chart panel.
 *
 * Contains:
 *   - Header with exchange/symbol selector + close button
 *   - TradingView Lightweight Chart (CandlestickChart)
 *   - Inline order panel (OrderPanel)
 */

import React, { useState } from "react";
import { useTerminalStore } from "../../stores/terminalStore";
import { CandlestickChart } from "./CandlestickChart";
import { SymbolSelector } from "./SymbolSelector";
import { OrderPanel } from "../Trading/OrderPanel";
import type { ChartConfig, ExchangeId } from "../../types";

interface Props {
  config: ChartConfig;
}

export function ChartWidget({ config }: Props) {
  const updateChart = useTerminalStore((s) => s.updateChart);
  const removeChart = useTerminalStore((s) => s.removeChart);
  const [showOrder, setShowOrder] = useState(false);
  // Incrementing this key forces CandlestickChart to remount and reload data
  const [resetKey, setResetKey] = useState(0);

  return (
    <div style={{
      height: "100%",
      display: "flex",
      flexDirection: "column",
      background: "#131722",
      border: "1px solid #2a2e39",
      borderRadius: 4,
      overflow: "hidden",
    }}>
      {/* Header */}
      <div
        style={{
          height: 28,
          background: "#1e222d",
          display: "flex",
          alignItems: "center",
          padding: "0 6px",
          gap: 6,
          fontSize: 12,
          userSelect: "none",
        }}
      >
        {/* Drag handle — only this grip area is draggable */}
        <div
          className="chart-drag-handle"
          style={{ cursor: "grab", color: "#555", fontSize: 10, padding: "0 2px" }}
        >
          ⠿
        </div>

        <SymbolSelector
          exchange={config.exchange}
          symbol={config.symbol}
          onChangeExchange={(e) => updateChart(config.id, { exchange: e as ExchangeId })}
          onChangeSymbol={(s) => updateChart(config.id, { symbol: s })}
        />

        {/* Interval selector — outside drag handle so clicks aren't swallowed */}
        {["1m", "5m", "15m", "1h", "4h", "1d"].map((iv) => (
          <button
            key={iv}
            onClick={() => updateChart(config.id, { interval: iv })}
            style={{
              background: config.interval === iv ? "#2962ff" : "transparent",
              color: config.interval === iv ? "#fff" : "#787b86",
              border: "none",
              borderRadius: 2,
              padding: "1px 5px",
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            {iv}
          </button>
        ))}

        <div style={{ flex: 1 }} />

        {/* Reset chart — reloads data, keeps timeframe */}
        <button
          onClick={() => setResetKey((k) => k + 1)}
          title="Reset chart"
          style={{
            background: "transparent",
            color: "#787b86",
            border: "none",
            cursor: "pointer",
            fontSize: 13,
            lineHeight: 1,
            padding: "0 2px",
          }}
        >
          ↺
        </button>

        <button
          onClick={() => setShowOrder(!showOrder)}
          style={{
            background: showOrder ? "#2962ff" : "transparent",
            color: "#d1d4dc",
            border: "1px solid #2a2e39",
            borderRadius: 2,
            padding: "1px 6px",
            cursor: "pointer",
            fontSize: 11,
          }}
        >
          Trade
        </button>

        <button
          onClick={() => removeChart(config.id)}
          style={{
            background: "transparent",
            color: "#ef5350",
            border: "none",
            cursor: "pointer",
            fontSize: 14,
            lineHeight: 1,
          }}
        >
          x
        </button>
      </div>

      {/* Chart area */}
      <div style={{ flex: 1, display: "flex" }}>
        <div style={{ flex: 1 }}>
          <CandlestickChart
            key={`${config.exchange}:${config.symbol}:${config.interval}:${resetKey}`}
            exchange={config.exchange}
            symbol={config.symbol}
            interval={config.interval}
          />
        </div>

        {/* Side order panel */}
        {showOrder && (
          <div style={{ width: 200, borderLeft: "1px solid #2a2e39" }}>
            <OrderPanel exchange={config.exchange} symbol={config.symbol} />
          </div>
        )}
      </div>
    </div>
  );
}
