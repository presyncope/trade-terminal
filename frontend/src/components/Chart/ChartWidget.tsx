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
      {/* Header — draggable handle */}
      <div
        className="chart-drag-handle"
        style={{
          height: 28,
          background: "#1e222d",
          display: "flex",
          alignItems: "center",
          padding: "0 6px",
          gap: 6,
          cursor: "grab",
          fontSize: 12,
        }}
      >
        <SymbolSelector
          exchange={config.exchange}
          symbol={config.symbol}
          onChangeExchange={(e) => updateChart(config.id, { exchange: e as ExchangeId })}
          onChangeSymbol={(s) => updateChart(config.id, { symbol: s })}
        />

        {/* Interval selector */}
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
