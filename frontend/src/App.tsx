import React from "react";
import { TerminalLayout } from "./components/Layout/TerminalLayout";
import { useWebSocket } from "./hooks/useWebSocket";

export default function App() {
  // Initialize central WebSocket connection
  useWebSocket();

  return (
    <div style={{ width: "100vw", height: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <header style={{
        height: 40,
        background: "#1e222d",
        borderBottom: "1px solid #2a2e39",
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        gap: 12,
      }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>IRH Terminal</span>
        <span style={{ fontSize: 11, color: "#787b86" }}>Intelligent Research Hub</span>
      </header>

      {/* Main grid area */}
      <main style={{ flex: 1, overflow: "hidden" }}>
        <TerminalLayout />
      </main>
    </div>
  );
}
