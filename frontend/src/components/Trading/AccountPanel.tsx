/**
 * AccountPanel — Bottom panel with three tabs:
 *   Open Orders  — live open orders from exchange, auto-refreshed, cancellable
 *   Fills        — real-time fill history (from WebSocket + store)
 *   Balance      — account asset balances, auto-refreshed
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useTerminalStore } from "../../stores/terminalStore";
import { fetchOpenOrders, fetchBalance } from "../../api/account";
import { cancelOrder } from "../../api/klines";
import type { ExchangeId, Fill, OpenOrder, BalanceEntry } from "../../types";

type Tab = "orders" | "fills" | "balance";

const EXCHANGES: { id: ExchangeId; label: string }[] = [
  { id: "binance_spot",    label: "Binance Spot"    },
  { id: "binance_futures", label: "Binance Futures" },
];

const REFRESH_MS = 10000;

export function AccountPanel() {
  const fills = useTerminalStore((s) => s.fills);

  const [tab, setTab]           = useState<Tab>("orders");
  const [exchange, setExchange] = useState<ExchangeId>("binance_spot");

  const [orders, setOrders]   = useState<OpenOrder[]>([]);
  const [balance, setBalance] = useState<BalanceEntry[]>([]);
  const [ordersStale, setOrdersStale]   = useState(false);
  const [balanceStale, setBalanceStale] = useState(false);
  const [cancelling, setCancelling] = useState<number | null>(null);

  // Track whether we've had at least one successful load
  const ordersLoadedRef  = useRef(false);
  const balanceLoadedRef = useRef(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadOrders = useCallback(async () => {
    try {
      const data = await fetchOpenOrders(exchange);
      // Always update — empty list is valid (all orders filled/cancelled)
      setOrders(data);
      ordersLoadedRef.current = true;
      setOrdersStale(false);
    } catch {
      // Keep previous data; mark stale so UI shows a warning dot
      setOrdersStale(true);
    }
  }, [exchange]);

  const loadBalance = useCallback(async () => {
    try {
      const data = await fetchBalance(exchange);
      if (data.length > 0) {
        // Only replace with a non-empty response
        setBalance(data);
        balanceLoadedRef.current = true;
        setBalanceStale(false);
      } else if (!balanceLoadedRef.current) {
        // First load with empty result is genuine (no funds on testnet)
        setBalance([]);
        balanceLoadedRef.current = true;
      }
      // If we already had data and got an empty response, treat as stale
      else {
        setBalanceStale(true);
      }
    } catch {
      setBalanceStale(true);
    }
  }, [exchange]);

  // Reset loaded flags when exchange changes
  useEffect(() => {
    ordersLoadedRef.current  = false;
    balanceLoadedRef.current = false;
    setOrders([]);
    setBalance([]);
    setOrdersStale(false);
    setBalanceStale(false);
  }, [exchange]);

  // Auto-refresh based on active tab
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    if (tab === "orders") {
      loadOrders();
      intervalRef.current = setInterval(loadOrders, REFRESH_MS);
    } else if (tab === "balance") {
      loadBalance();
      intervalRef.current = setInterval(loadBalance, REFRESH_MS);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [tab, exchange, loadOrders, loadBalance]);

  const handleCancel = async (order: OpenOrder) => {
    setCancelling(order.orderId);
    try {
      await cancelOrder({ exchange, symbol: order.symbol, order_id: String(order.orderId) });
      // Remove from local list immediately for snappy feedback
      setOrders((prev) => prev.filter((o) => o.orderId !== order.orderId));
    } catch (e: any) {
      alert(`Cancel failed: ${e.message}`);
    } finally {
      setCancelling(null);
    }
  };

  const s = styles;

  return (
    <div style={s.root}>
      {/* Header: exchange selector + tabs */}
      <div style={s.header}>
        <select
          value={exchange}
          onChange={(e) => setExchange(e.target.value as ExchangeId)}
          style={s.exchangeSelect}
        >
          {EXCHANGES.map((ex) => (
            <option key={ex.id} value={ex.id}>{ex.label}</option>
          ))}
        </select>

        <div style={s.tabs}>
          <button onClick={() => setTab("orders")} style={{ ...s.tab, ...(tab === "orders" ? s.tabActive : {}) }}>
            Open Orders{ordersStale ? " ⚠" : ""}
          </button>
          <button onClick={() => setTab("fills")} style={{ ...s.tab, ...(tab === "fills" ? s.tabActive : {}) }}>
            Fills
          </button>
          <button onClick={() => setTab("balance")} style={{ ...s.tab, ...(tab === "balance" ? s.tabActive : {}) }}>
            Balance{balanceStale ? " ⚠" : ""}
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={s.body}>
        {tab === "orders" && (
          <OrdersTab orders={orders} stale={ordersStale} cancelling={cancelling} onCancel={handleCancel} />
        )}
        {tab === "fills" && <FillsTab fills={fills} />}
        {tab === "balance" && <BalanceTab balance={balance} stale={balanceStale} />}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function OrdersTab({
  orders,
  stale,
  cancelling,
  onCancel,
}: {
  orders: OpenOrder[];
  stale: boolean;
  cancelling: number | null;
  onCancel: (o: OpenOrder) => void;
}) {
  if (orders.length === 0) return (
    <div style={styles.empty}>
      No open orders{stale ? <span style={{ color: "#f0b90b", marginLeft: 6 }}>⚠ refresh error</span> : ""}
    </div>
  );

  return (
    <table style={styles.table}>
      <thead>
        <tr>
          {["Time", "Symbol", "Side", "Type", "Price", "Qty", "Filled", "TIF", ""].map((h) => (
            <th key={h} style={styles.th}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {orders.map((o) => (
          <tr key={o.orderId}>
            <td style={styles.td}>{new Date(o.time).toLocaleTimeString()}</td>
            <td style={styles.td}>{o.symbol}</td>
            <td style={{ ...styles.td, color: o.side === "BUY" ? "#26a69a" : "#ef5350", fontWeight: 600 }}>
              {o.side}
            </td>
            <td style={styles.td}>{o.type}</td>
            <td style={styles.td}>{parseFloat(o.price).toFixed(2)}</td>
            <td style={styles.td}>{parseFloat(o.origQty)}</td>
            <td style={styles.td}>{parseFloat(o.executedQty)}</td>
            <td style={styles.td}>{o.timeInForce}</td>
            <td style={styles.td}>
              <button
                onClick={() => onCancel(o)}
                disabled={cancelling === o.orderId}
                style={styles.cancelBtn}
              >
                {cancelling === o.orderId ? "…" : "✕"}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FillsTab({ fills }: { fills: Fill[] }) {
  if (fills.length === 0) return <div style={styles.empty}>No fills yet</div>;

  return (
    <table style={styles.table}>
      <thead>
        <tr>
          {["Time", "Exchange", "Symbol", "Side", "Price", "Qty", "Status"].map((h) => (
            <th key={h} style={styles.th}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {fills.map((f, i) => (
          <tr key={`${f.ts}-${i}`}>
            <td style={styles.td}>{new Date(f.ts).toLocaleTimeString()}</td>
            <td style={styles.td}>{f.exchange}</td>
            <td style={styles.td}>{f.symbol}</td>
            <td style={{ ...styles.td, color: f.side === "BUY" ? "#26a69a" : "#ef5350", fontWeight: 600 }}>
              {f.side}
            </td>
            <td style={styles.td}>{f.price > 0 ? f.price.toFixed(2) : "—"}</td>
            <td style={styles.td}>{f.quantity}</td>
            <td style={{ ...styles.td, color: statusColor(f.status) }}>
              {f.status ?? (f.is_manual ? "Manual" : "Strategy")}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BalanceTab({ balance, stale }: { balance: BalanceEntry[]; stale: boolean }) {
  if (balance.length === 0) return (
    <div style={styles.empty}>
      No balances{stale ? <span style={{ color: "#f0b90b", marginLeft: 6 }}>⚠ refresh error</span> : ""}
    </div>
  );

  return (
    <table style={styles.table}>
      <thead>
        <tr>
          {["Asset", "Available", "In Order", "Total"].map((h) => (
            <th key={h} style={styles.th}>{h}</th>
          ))}
          <th style={{ ...styles.th, color: stale ? "#f0b90b" : "transparent" }}>⚠</th>
        </tr>
      </thead>
      <tbody>
        {balance.map((b) => {
          const free   = parseFloat(b.free);
          const locked = parseFloat(b.locked);
          return (
            <tr key={b.asset}>
              <td style={{ ...styles.td, fontWeight: 600, color: "#d1d4dc" }}>{b.asset}</td>
              <td style={styles.td}>{free.toFixed(8).replace(/\.?0+$/, "")}</td>
              <td style={{ ...styles.td, color: locked > 0 ? "#f0b90b" : "#555" }}>
                {locked.toFixed(8).replace(/\.?0+$/, "")}
              </td>
              <td style={styles.td}>{(free + locked).toFixed(8).replace(/\.?0+$/, "")}</td>
              <td style={styles.td} />
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function statusColor(status?: string): string {
  if (!status) return "#787b86";
  switch (status.toUpperCase()) {
    case "FILLED":           return "#26a69a";
    case "NEW":              return "#2962ff";
    case "PARTIALLY_FILLED": return "#f0b90b";
    case "CANCELED":         return "#ef5350";
    default:                 return "#787b86";
  }
}

// ── Styles ───────────────────────────────────────────────────────────────────

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
    gap: 8,
    padding: "0 8px",
    height: 32,
    borderBottom: "1px solid #2a2e39",
    flexShrink: 0,
  },
  exchangeSelect: {
    background: "#131722",
    color: "#d1d4dc",
    border: "1px solid #2a2e39",
    borderRadius: 3,
    padding: "2px 4px",
    fontSize: 11,
    cursor: "pointer",
  },
  tabs: {
    display: "flex" as const,
    gap: 2,
  },
  tab: {
    background: "transparent",
    color: "#787b86",
    border: "none",
    borderRadius: 3,
    padding: "2px 8px",
    cursor: "pointer",
    fontSize: 11,
  },
  tabActive: {
    background: "#2a2e39",
    color: "#d1d4dc",
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
  cancelBtn: {
    background: "transparent",
    color: "#ef5350",
    border: "1px solid #ef5350",
    borderRadius: 2,
    padding: "1px 5px",
    cursor: "pointer",
    fontSize: 10,
    lineHeight: 1.2,
  },
  empty: {
    padding: "12px 16px",
    color: "#555",
    fontSize: 11,
  },
};
