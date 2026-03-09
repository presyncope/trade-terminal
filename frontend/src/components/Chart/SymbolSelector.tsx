/**
 * SymbolSelector — Exchange & symbol dropdown for each chart.
 */

import React from "react";
import type { ExchangeId } from "../../types";

const EXCHANGES: { id: ExchangeId; label: string }[] = [
  { id: "binance_spot", label: "Binance Spot" },
  { id: "binance_futures", label: "Binance Futures" },
  { id: "hyperliquid", label: "Hyperliquid" },
];

const SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT",
  "XRPUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT",
];

interface Props {
  exchange: ExchangeId;
  symbol: string;
  onChangeExchange: (exchange: string) => void;
  onChangeSymbol: (symbol: string) => void;
}

const selectStyle: React.CSSProperties = {
  background: "#131722",
  color: "#d1d4dc",
  border: "1px solid #2a2e39",
  borderRadius: 2,
  fontSize: 11,
  padding: "1px 4px",
  cursor: "pointer",
};

export function SymbolSelector({ exchange, symbol, onChangeExchange, onChangeSymbol }: Props) {
  return (
    <>
      <select
        value={exchange}
        onChange={(e) => onChangeExchange(e.target.value)}
        style={selectStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {EXCHANGES.map((ex) => (
          <option key={ex.id} value={ex.id}>{ex.label}</option>
        ))}
      </select>

      <select
        value={symbol}
        onChange={(e) => onChangeSymbol(e.target.value)}
        style={selectStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {SYMBOLS.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
    </>
  );
}
