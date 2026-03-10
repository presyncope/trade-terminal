/**
 * Account API — open orders and balances.
 */

import type { OpenOrder, BalanceEntry } from "../types";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export async function fetchOpenOrders(
  exchange: string,
  symbol?: string,
): Promise<OpenOrder[]> {
  const p = new URLSearchParams({ exchange });
  if (symbol) p.set("symbol", symbol);
  const resp = await fetch(`${API_URL}/api/open-orders?${p}`);
  if (!resp.ok) throw new Error(`Failed to fetch open orders: ${resp.statusText}`);
  return resp.json();
}

export async function fetchBalance(exchange: string): Promise<BalanceEntry[]> {
  const resp = await fetch(`${API_URL}/api/balance?exchange=${exchange}`);
  if (!resp.ok) throw new Error(`Failed to fetch balance: ${resp.statusText}`);
  return resp.json();
}
