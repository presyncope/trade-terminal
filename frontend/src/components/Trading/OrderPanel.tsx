/**
 * OrderPanel — Manual trading panel for each chart.
 *
 * Allows placing MARKET or LIMIT buy/sell orders
 * for the currently selected exchange/symbol.
 */

import React, { useState, useCallback } from "react";
import { submitOrder } from "../../api/klines";
import type { ExchangeId } from "../../types";

interface Props {
  exchange: ExchangeId;
  symbol: string;
}

export function OrderPanel({ exchange, symbol }: Props) {
  const [orderType, setOrderType] = useState<"MARKET" | "LIMIT">("MARKET");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (side: "BUY" | "SELL") => {
      if (!quantity || Number(quantity) <= 0) return;
      if (orderType === "LIMIT" && (!price || Number(price) <= 0)) return;

      setSubmitting(true);
      setLastResult(null);

      try {
        const result = await submitOrder({
          exchange,
          symbol,
          side,
          type: orderType,
          quantity: Number(quantity),
          price: orderType === "LIMIT" ? Number(price) : undefined,
        });
        setLastResult(`${side} submitted`);
      } catch (err: any) {
        setLastResult(`Error: ${err.message}`);
      } finally {
        setSubmitting(false);
      }
    },
    [exchange, symbol, orderType, quantity, price]
  );

  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: "#131722",
    color: "#d1d4dc",
    border: "1px solid #2a2e39",
    borderRadius: 3,
    padding: "4px 6px",
    fontSize: 12,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 10,
    color: "#787b86",
    marginBottom: 2,
  };

  return (
    <div style={{ padding: 8, fontSize: 12, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontWeight: 600, marginBottom: 2 }}>
        {symbol}
      </div>

      {/* Order Type Toggle */}
      <div style={{ display: "flex", gap: 4 }}>
        {(["MARKET", "LIMIT"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setOrderType(t)}
            style={{
              flex: 1,
              background: orderType === t ? "#2962ff" : "#1e222d",
              color: orderType === t ? "#fff" : "#787b86",
              border: "none",
              borderRadius: 3,
              padding: "3px 0",
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Quantity */}
      <div>
        <div style={labelStyle}>Quantity</div>
        <input
          type="number"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="0.001"
          style={inputStyle}
          step="any"
        />
      </div>

      {/* Price (LIMIT only) */}
      {orderType === "LIMIT" && (
        <div>
          <div style={labelStyle}>Price</div>
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="50000"
            style={inputStyle}
            step="any"
          />
        </div>
      )}

      {/* Buy / Sell buttons */}
      <div style={{ display: "flex", gap: 4 }}>
        <button
          onClick={() => handleSubmit("BUY")}
          disabled={submitting}
          style={{
            flex: 1,
            background: "#26a69a",
            color: "#fff",
            border: "none",
            borderRadius: 3,
            padding: "6px 0",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: 12,
          }}
        >
          BUY
        </button>
        <button
          onClick={() => handleSubmit("SELL")}
          disabled={submitting}
          style={{
            flex: 1,
            background: "#ef5350",
            color: "#fff",
            border: "none",
            borderRadius: 3,
            padding: "6px 0",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: 12,
          }}
        >
          SELL
        </button>
      </div>

      {/* Status */}
      {lastResult && (
        <div style={{ fontSize: 10, color: "#787b86", textAlign: "center" }}>
          {lastResult}
        </div>
      )}
    </div>
  );
}
