import React, { useState } from "react";
import { TerminalLayout } from "./components/Layout/TerminalLayout";
import { BacktestPage } from "./components/Backtest/BacktestPage";
import { useWebSocket } from "./hooks/useWebSocket";

type Page = "trade" | "backtest";

export default function App() {
  // Initialize central WebSocket connection
  useWebSocket();

  const [page, setPage] = useState<Page>("trade");

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
        gap: 16,
        flexShrink: 0,
      }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>IRH Terminal</span>
        <span style={{ fontSize: 11, color: "#787b86" }}>Intelligent Research Hub</span>

        {/* Navigation */}
        <nav style={{ display: "flex", gap: 2, marginLeft: 8 }}>
          <NavButton active={page === "trade"} onClick={() => setPage("trade")}>
            Trade
          </NavButton>
          <NavButton active={page === "backtest"} onClick={() => setPage("backtest")}>
            Backtest
          </NavButton>
        </nav>
      </header>

      {/* Page content */}
      <main style={{ flex: 1, overflow: "hidden" }}>
        {page === "trade"    && <TerminalLayout />}
        {page === "backtest" && <BacktestPage />}
      </main>
    </div>
  );
}

function NavButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background:   active ? "#2a2e39" : "transparent",
        color:        active ? "#d1d4dc" : "#787b86",
        border:       active ? "1px solid #3a3e4a" : "1px solid transparent",
        borderRadius: 4,
        padding:      "3px 14px",
        cursor:       "pointer",
        fontSize:     12,
        fontWeight:   active ? 600 : 400,
        transition:   "all 0.1s",
      }}
    >
      {children}
    </button>
  );
}
