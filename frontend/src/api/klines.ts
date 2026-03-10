/**
 * REST API client for historical kline data.
 */

import type { Kline, ExchangeId } from "../types";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export interface KlinesResponse {
  data: Kline[];
  backfill_triggered: boolean;
}

export async function fetchKlines(params: {
  exchange: ExchangeId;
  symbol: string;
  interval?: string;
  start?: string;
  end?: string;
  limit?: number;
}): Promise<KlinesResponse> {
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

export type OrderType =
  | "MARKET"
  | "LIMIT"
  | "LIMIT_MAKER"
  | "STOP_LOSS_LIMIT"
  | "TAKE_PROFIT_LIMIT"
  | "OCO";

export type TimeInForce = "GTC" | "IOC" | "FOK";

export interface OrderRequest {
  exchange: ExchangeId;
  symbol: string;
  side: "BUY" | "SELL";
  type: OrderType;
  quantity: number;
  /** Limit execution price — required for LIMIT, LIMIT_MAKER, STOP_LOSS_LIMIT, TAKE_PROFIT_LIMIT, OCO */
  price?: number;
  /** Trigger price — required for STOP_LOSS_LIMIT, TAKE_PROFIT_LIMIT, OCO */
  stop_price?: number;
  /** Stop leg's limit price — required for OCO */
  stop_limit_price?: number;
  /** Time in force — applicable to LIMIT, STOP_LOSS_LIMIT, TAKE_PROFIT_LIMIT, OCO */
  time_in_force?: TimeInForce;
}

export async function submitOrder(order: OrderRequest): Promise<{ status: string }> {
  const resp = await fetch(`${API_URL}/api/order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(order),
  });
  if (!resp.ok) throw new Error(`Order failed: ${resp.statusText}`);
  return resp.json();
}

export async function cancelOrder(params: {
  exchange: ExchangeId;
  symbol: string;
  order_id: string;
}): Promise<{ status: string }> {
  const resp = await fetch(`${API_URL}/api/order/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!resp.ok) throw new Error(`Cancel failed: ${resp.statusText}`);
  return resp.json();
}
