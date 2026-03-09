/**
 * TradeHistory — Bottom panel showing all fill events.
 *
 * Displays a scrollable table of fills from all exchanges/symbols,
 * updated in real-time as fills arrive via WebSocket.
 */

import React from "react";
import { useTerminalStore } from "../../stores/terminalStore";

const thStyle: React.CSSProperties = {
  padding: "4px 8px",
  textAlign: "left",
  fontSize: 10,
  color: "#787b86",
  fontWeight: 500,
  borderBottom: "1px solid #2a2e39",
  position: "sticky",
  top: 0,
  background: "#1e222d",
};

const tdStyle: React.CSSProperties = {
  padding: "3px 8px",
  fontSize: 11,
  borderBottom: "1px solid #1e222d",
};

export function TradeHistory() {
  const fills = useTerminalStore((s) => s.fills);

  return (
    <div style={{ height: "100%", overflow: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={thStyle}>Time</th>
            <th style={thStyle}>Exchange</th>
            <th style={thStyle}>Symbol</th>
            <th style={thStyle}>Side</th>
            <th style={thStyle}>Price</th>
            <th style={thStyle}>Qty</th>
            <th style={thStyle}>Type</th>
          </tr>
        </thead>
        <tbody>
          {fills.length === 0 ? (
            <tr>
              <td colSpan={7} style={{ ...tdStyle, textAlign: "center", color: "#787b86" }}>
                No fills yet
              </td>
            </tr>
          ) : (
            fills.map((fill, i) => (
              <tr key={`${fill.ts}-${i}`}>
                <td style={tdStyle}>
                  {new Date(fill.ts).toLocaleTimeString()}
                </td>
                <td style={tdStyle}>{fill.exchange}</td>
                <td style={tdStyle}>{fill.symbol}</td>
                <td style={{
                  ...tdStyle,
                  color: fill.side === "BUY" ? "#26a69a" : "#ef5350",
                  fontWeight: 600,
                }}>
                  {fill.side}
                </td>
                <td style={tdStyle}>{fill.price.toFixed(2)}</td>
                <td style={tdStyle}>{fill.quantity}</td>
                <td style={tdStyle}>
                  {fill.is_manual ? "Manual" : "Strategy"}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
