/** Supported exchanges */
export type ExchangeId = "binance_spot" | "binance_futures" | "hyperliquid";

export interface Exchange {
  id: ExchangeId;
  name: string;
  type: "spot" | "futures";
}

/** OHLCV candle (TradingView Lightweight Charts format) */
export interface Kline {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/** Real-time kline update from WebSocket (DataStream format uses ts: ISO string) */
export interface KlineUpdate {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  closed: boolean;
}

/** Trade fill event */
export interface Fill {
  ts: string;
  exchange: string;
  symbol: string;
  side: "BUY" | "SELL";
  price: number;
  quantity: number;
  order_id?: string;
  status?: string;
  is_manual: boolean;
}

/** Open order from exchange */
export interface OpenOrder {
  orderId: number;
  symbol: string;
  side: "BUY" | "SELL";
  type: string;
  price: string;
  origQty: string;
  executedQty: string;
  status: string;
  timeInForce: string;
  time: number;
}

/** Account balance entry */
export interface BalanceEntry {
  asset: string;
  free: string;
  locked: string;
}

// OrderRequest is defined in api/klines.ts with full type support

/** Chart widget configuration */
export interface ChartConfig {
  id: string;
  exchange: ExchangeId;
  symbol: string;
  interval: string;
}

/** React-Grid-Layout item */
export interface LayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
