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

/** Real-time kline update from WebSocket */
export interface KlineUpdate extends Kline {
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
  is_manual: boolean;
}

/** Manual order request */
export interface OrderRequest {
  exchange: ExchangeId;
  symbol: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT";
  quantity: number;
  price?: number;
}

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
