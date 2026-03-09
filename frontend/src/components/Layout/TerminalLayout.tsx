/**
 * TerminalLayout — Dynamic multi-chart grid using react-grid-layout.
 *
 * Users can:
 *   - Add new chart panels (+ button)
 *   - Drag & resize panels
 *   - Remove panels (x button on each)
 *
 * Bottom section shows the trade history table.
 */

import React, { useCallback } from "react";
import GridLayout from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import { useTerminalStore } from "../../stores/terminalStore";
import { ChartWidget } from "../Chart/ChartWidget";
import { TradeHistory } from "../Trading/TradeHistory";
import type { LayoutItem } from "../../types";

export function TerminalLayout() {
  const charts = useTerminalStore((s) => s.charts);
  const layout = useTerminalStore((s) => s.layout);
  const updateLayout = useTerminalStore((s) => s.updateLayout);
  const addChart = useTerminalStore((s) => s.addChart);
  const wsConnected = useTerminalStore((s) => s.wsConnected);

  const onLayoutChange = useCallback(
    (newLayout: GridLayout.Layout[]) => {
      updateLayout(
        newLayout.map((l) => ({ i: l.i, x: l.x, y: l.y, w: l.w, h: l.h }))
      );
    },
    [updateLayout]
  );

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Toolbar */}
      <div style={{
        height: 32,
        background: "#1e222d",
        borderBottom: "1px solid #2a2e39",
        display: "flex",
        alignItems: "center",
        padding: "0 8px",
        gap: 8,
      }}>
        <button
          onClick={() => addChart()}
          style={{
            background: "#2962ff",
            color: "#fff",
            border: "none",
            borderRadius: 3,
            padding: "2px 10px",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          + Add Chart
        </button>
        <span style={{
          marginLeft: "auto",
          fontSize: 11,
          color: wsConnected ? "#26a69a" : "#ef5350",
        }}>
          {wsConnected ? "LIVE" : "DISCONNECTED"}
        </span>
      </div>

      {/* Chart Grid */}
      <div style={{ flex: 1, overflow: "auto", padding: 4 }}>
        <GridLayout
          layout={layout as GridLayout.Layout[]}
          cols={12}
          rowHeight={80}
          width={window.innerWidth - 8}
          onLayoutChange={onLayoutChange}
          draggableHandle=".chart-drag-handle"
          compactType="vertical"
          isResizable
          isDraggable
        >
          {charts.map((chart) => (
            <div key={chart.id}>
              <ChartWidget config={chart} />
            </div>
          ))}
        </GridLayout>
      </div>

      {/* Trade History (bottom panel) */}
      <div style={{
        height: 180,
        borderTop: "1px solid #2a2e39",
        background: "#1e222d",
        overflow: "auto",
      }}>
        <TradeHistory />
      </div>
    </div>
  );
}
