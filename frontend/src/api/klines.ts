/**
 * REST API client for historical kline data.
 */

import type { Kline, ExchangeId } from "../types";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export async function fetchKlines(params: {
  exchange: ExchangeId;
  symbol: string;
  interval?: string;
  start?: string;
  end?: string;
  limit?: number;
}): Promise<Kline[]> {
  const searchParams = new URLSearchParams();
  searchParams.set("exchange", params.exchange);
  searchParams.set("symbol", params.symbol);
  if (params.interval) searchParams.set("interval", params.interval);
  if (params.start) searchParams.set("start", params.start);
  if (params.end) searchParams.set("end", params.end);
  if (params.limit) searchParams.set("limit", String(params.limit));

  const resp = await fetch(`${API_URL}/api/klines?${searchParams}`);
  if (!resp.ok) throw new Error(`Failed to fetch klines: ${resp.statusText}`);
  return resp.json();
}

export async function submitOrder(order: {
  exchange: ExchangeId;
  symbol: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT";
  quantity: number;
  price?: number;
}): Promise<{ status: string }> {
  const resp = await fetch(`${API_URL}/api/order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(order),
  });
  if (!resp.ok) throw new Error(`Order failed: ${resp.statusText}`);
  return resp.json();
}
