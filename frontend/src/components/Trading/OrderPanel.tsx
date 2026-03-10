/**
 * OrderPanel — Manual trading panel for Binance Spot.
 *
 * Supported order types:
 *   MARKET            — execute at market price
 *   LIMIT             — rest at specified price (GTC / IOC / FOK)
 *   LIMIT_MAKER       — post-only limit
 *   STOP_LIMIT        — stop-loss limit (triggers at stop price, executes at limit price)
 *   TAKE_PROFIT_LIMIT — take-profit limit (same mechanics, opposite intent)
 *   OCO               — linked limit (TP) + stop-limit (SL) pair
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { submitOrder, fetchKlines } from "../../api/klines";
import { onKlineUpdate } from "../../hooks/useWebSocket";
import type { ExchangeId } from "../../types";
import type { OrderType, TimeInForce } from "../../api/klines";

interface Props {
  exchange: ExchangeId;
  symbol: string;
}

const ORDER_TYPES: { value: OrderType; label: string }[] = [
  { value: "MARKET",            label: "Market"    },
  { value: "LIMIT",             label: "Limit"     },
  { value: "LIMIT_MAKER",       label: "Post-Only" },
  { value: "STOP_LOSS_LIMIT",   label: "Stop Lmt"  },
  { value: "TAKE_PROFIT_LIMIT", label: "TP Lmt"    },
  { value: "OCO",               label: "OCO"       },
];

const TIF_OPTIONS: TimeInForce[] = ["GTC", "IOC", "FOK"];

// Known quote currencies ordered longest-first to avoid greedy mis-match
const QUOTE_CURRENCIES = ["USDT", "BUSD", "USDC", "TUSD", "BTC", "ETH", "BNB"];

function parseSymbol(symbol: string): { base: string; quote: string } {
  for (const q of QUOTE_CURRENCIES) {
    if (symbol.endsWith(q)) return { base: symbol.slice(0, -q.length), quote: q };
  }
  return { base: symbol, quote: "" };
}

function fmt(n: number, decimals = 6): string {
  if (!isFinite(n) || n === 0) return "0";
  return parseFloat(n.toFixed(decimals)).toString();
}

export function OrderPanel({ exchange, symbol }: Props) {
  const [orderType, setOrderType] = useState<OrderType>("MARKET");
  const [amountMode, setAmountMode] = useState<"base" | "quote">("base");
  const [quantity, setQuantity]   = useState("");
  const [price, setPrice]         = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [stopLimitPrice, setStopLimitPrice] = useState("");
  const [tif, setTif]             = useState<TimeInForce>("GTC");
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const lastPriceRef = useRef<number>(0);
  const [lastPrice, setLastPrice] = useState(0);

  const { base, quote } = parseSymbol(symbol);

  // Seed last price from REST (last 1 candle)
  useEffect(() => {
    fetchKlines({ exchange, symbol, interval: "1m", limit: 1 })
      .then(({ data }) => {
        if (data.length > 0) {
          const p = data[data.length - 1].close;
          lastPriceRef.current = p;
          setLastPrice(p);
        }
      })
      .catch(() => {});
  }, [exchange, symbol]);

  // Keep last price updated via WS kline stream
  useEffect(() => {
    return onKlineUpdate((ex, sym, data) => {
      if (ex === exchange && sym === symbol) {
        lastPriceRef.current = data.close;
        setLastPrice(data.close);
      }
    });
  }, [exchange, symbol]);

  // Reset amount mode when symbol changes
  useEffect(() => {
    setAmountMode("base");
    setQuantity("");
  }, [symbol]);

  const needsPrice     = orderType !== "MARKET";
  const needsStop      = orderType === "STOP_LOSS_LIMIT" || orderType === "TAKE_PROFIT_LIMIT" || orderType === "OCO";
  const needsStopLimit = orderType === "OCO";
  const needsTif       = orderType === "LIMIT" || orderType === "STOP_LOSS_LIMIT" || orderType === "TAKE_PROFIT_LIMIT" || orderType === "OCO";

  // Effective execution price: use entered limit price if available, else live price
  const execPrice = (needsPrice && Number(price) > 0) ? Number(price) : lastPrice;

  // Conversion hint
  const qtyNum = Number(quantity) || 0;
  let conversionLine = "";
  if (qtyNum > 0 && execPrice > 0) {
    if (amountMode === "base") {
      conversionLine = `≈ ${fmt(qtyNum * execPrice, 2)} ${quote}`;
    } else {
      conversionLine = `≈ ${fmt(qtyNum / execPrice, 6)} ${base}`;
    }
  }

  const validate = (): string | null => {
    if (!quantity || Number(quantity) <= 0) return "Quantity required";
    if (needsPrice && (!price || Number(price) <= 0)) return "Price required";
    if (needsStop && (!stopPrice || Number(stopPrice) <= 0)) return "Stop price required";
    if (needsStopLimit && (!stopLimitPrice || Number(stopLimitPrice) <= 0)) return "Stop limit price required";
    if (amountMode === "quote" && execPrice <= 0) return "No price data for conversion";
    return null;
  };

  const handleSubmit = useCallback(
    async (side: "BUY" | "SELL") => {
      const err = validate();
      if (err) { setLastResult({ ok: false, msg: err }); return; }

      // Convert quote amount to base quantity if needed
      const baseQty = amountMode === "quote"
        ? Number(quantity) / execPrice
        : Number(quantity);

      setSubmitting(true);
      setLastResult(null);
      try {
        await submitOrder({
          exchange,
          symbol,
          side,
          type: orderType,
          quantity: baseQty,
          price:            needsPrice     ? Number(price)          : undefined,
          stop_price:       needsStop      ? Number(stopPrice)       : undefined,
          stop_limit_price: needsStopLimit ? Number(stopLimitPrice)  : undefined,
          time_in_force:    needsTif       ? tif                     : undefined,
        });
        setLastResult({ ok: true, msg: `${side} ${orderType} submitted` });
      } catch (e: any) {
        setLastResult({ ok: false, msg: e.message });
      } finally {
        setSubmitting(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [exchange, symbol, orderType, amountMode, quantity, price, stopPrice, stopLimitPrice, tif, execPrice]
  );

  const s = styles;

  return (
    <div style={s.panel}>
      <div style={s.header}>{symbol}</div>

      {/* Order type tabs — 2 rows of 3 */}
      <div style={s.typeGrid}>
        {ORDER_TYPES.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setOrderType(value)}
            style={{
              ...s.typeBtn,
              ...(orderType === value ? s.typeBtnActive : {}),
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Amount with base/quote toggle */}
      <div style={{ marginBottom: 5 }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 2, gap: 4 }}>
          <span style={{ fontSize: 10, color: "#787b86" }}>Amount</span>
          <div style={{ display: "flex", marginLeft: "auto", gap: 2 }}>
            <button
              onClick={() => setAmountMode("base")}
              style={{ ...s.modeBtn, ...(amountMode === "base" ? s.modeBtnActive : {}) }}
            >
              {base || "Base"}
            </button>
            <button
              onClick={() => setAmountMode("quote")}
              style={{ ...s.modeBtn, ...(amountMode === "quote" ? s.modeBtnActive : {}) }}
            >
              {quote || "Quote"}
            </button>
          </div>
        </div>
        <input
          type="number" step="any" min="0"
          placeholder={amountMode === "base" ? `0.001 ${base}` : `10 ${quote}`}
          value={quantity} onChange={e => setQuantity(e.target.value)}
          style={s.input}
        />
        {conversionLine && (
          <div style={s.conversion}>{conversionLine}</div>
        )}
      </div>

      {/* Limit price */}
      {needsPrice && (
        <Field label={orderType === "OCO" ? "TP Price" : "Price"}>
          <input
            type="number" step="any" min="0" placeholder="0"
            value={price} onChange={e => setPrice(e.target.value)}
            style={s.input}
          />
        </Field>
      )}

      {/* Stop trigger price */}
      {needsStop && (
        <Field label="Stop Price">
          <input
            type="number" step="any" min="0" placeholder="0"
            value={stopPrice} onChange={e => setStopPrice(e.target.value)}
            style={s.input}
          />
        </Field>
      )}

      {/* OCO: stop-limit execution price */}
      {needsStopLimit && (
        <Field label="SL Limit">
          <input
            type="number" step="any" min="0" placeholder="0"
            value={stopLimitPrice} onChange={e => setStopLimitPrice(e.target.value)}
            style={s.input}
          />
        </Field>
      )}

      {/* Time in Force */}
      {needsTif && (
        <Field label="TIF">
          <div style={{ display: "flex", gap: 3 }}>
            {TIF_OPTIONS.map(t => (
              <button
                key={t}
                onClick={() => setTif(t)}
                style={{
                  ...s.tifBtn,
                  ...(tif === t ? s.tifBtnActive : {}),
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </Field>
      )}

      {/* Description hint */}
      <div style={s.hint}>{HINTS[orderType]}</div>

      {/* BUY / SELL */}
      <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
        <button
          onClick={() => handleSubmit("BUY")}
          disabled={submitting}
          style={{ ...s.tradeBtn, background: "#26a69a" }}
        >
          BUY
        </button>
        <button
          onClick={() => handleSubmit("SELL")}
          disabled={submitting}
          style={{ ...s.tradeBtn, background: "#ef5350" }}
        >
          SELL
        </button>
      </div>

      {/* Status */}
      {lastResult && (
        <div style={{ ...s.status, color: lastResult.ok ? "#26a69a" : "#ef5350" }}>
          {lastResult.msg}
        </div>
      )}

      {/* Live price */}
      {lastPrice > 0 && (
        <div style={s.livePrice}>
          {lastPrice.toLocaleString(undefined, { maximumFractionDigits: 8 })} {quote}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 5 }}>
      <div style={{ fontSize: 10, color: "#787b86", marginBottom: 2 }}>{label}</div>
      {children}
    </div>
  );
}

const HINTS: Record<OrderType, string> = {
  MARKET:            "Fill at best available price",
  LIMIT:             "Rest on book at specified price",
  LIMIT_MAKER:       "Post-only — rejected if it would take",
  STOP_LOSS_LIMIT:   "Triggers at stop → executes as limit",
  TAKE_PROFIT_LIMIT: "Triggers at stop → executes as limit",
  OCO:               "TP limit + SL stop-limit, one cancels other",
};

const styles = {
  panel: {
    padding: "8px 8px",
    fontSize: 12,
    display: "flex" as const,
    flexDirection: "column" as const,
    gap: 0,
    overflowY: "auto" as const,
    height: "100%",
  },
  header: {
    fontWeight: 600,
    marginBottom: 7,
    fontSize: 12,
    color: "#d1d4dc",
  },
  typeGrid: {
    display: "grid" as const,
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: 3,
    marginBottom: 8,
  },
  typeBtn: {
    background: "#1e222d",
    color: "#787b86",
    border: "none",
    borderRadius: 3,
    padding: "3px 2px",
    cursor: "pointer",
    fontSize: 10,
    textAlign: "center" as const,
  },
  typeBtnActive: {
    background: "#2962ff",
    color: "#fff",
  },
  modeBtn: {
    background: "#1e222d",
    color: "#787b86",
    border: "none",
    borderRadius: 3,
    padding: "2px 5px",
    cursor: "pointer",
    fontSize: 9,
    fontWeight: 500 as const,
  },
  modeBtnActive: {
    background: "#363a45",
    color: "#d1d4dc",
  },
  input: {
    width: "100%",
    background: "#131722",
    color: "#d1d4dc",
    border: "1px solid #2a2e39",
    borderRadius: 3,
    padding: "4px 6px",
    fontSize: 12,
    boxSizing: "border-box" as const,
  },
  conversion: {
    fontSize: 9,
    color: "#787b86",
    marginTop: 2,
    textAlign: "right" as const,
  },
  tifBtn: {
    flex: 1,
    background: "#1e222d",
    color: "#787b86",
    border: "none",
    borderRadius: 3,
    padding: "3px 0",
    cursor: "pointer",
    fontSize: 10,
  },
  tifBtnActive: {
    background: "#363a45",
    color: "#d1d4dc",
  },
  hint: {
    fontSize: 9,
    color: "#555",
    marginBottom: 6,
    lineHeight: 1.3,
  },
  tradeBtn: {
    flex: 1,
    color: "#fff",
    border: "none",
    borderRadius: 3,
    padding: "7px 0",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: 12,
  },
  status: {
    fontSize: 10,
    textAlign: "center" as const,
    marginTop: 5,
    wordBreak: "break-word" as const,
  },
  livePrice: {
    fontSize: 9,
    color: "#555",
    textAlign: "center" as const,
    marginTop: 6,
  },
};
