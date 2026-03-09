/**
 * CandlestickChart — TradingView Lightweight Charts wrapper.
 *
 * - Loads historical data from REST API on mount
 * - Subscribes to real-time kline updates via WebSocket
 * - Displays fill markers (triangles) on the chart
 */

import React, { useEffect, useRef, useCallback } from "react";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type SeriesMarker,
  type Time,
  ColorType,
} from "lightweight-charts";
import { fetchKlines } from "../../api/klines";
import { onKlineUpdate, wsSubscribe, wsUnsubscribe } from "../../hooks/useWebSocket";
import { useTerminalStore } from "../../stores/terminalStore";
import type { ExchangeId, KlineUpdate, Fill } from "../../types";

interface Props {
  exchange: ExchangeId;
  symbol: string;
  interval: string;
}

export function CandlestickChart({ exchange, symbol, interval }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const fills = useTerminalStore((s) => s.fills);

  // ─── Create chart on mount ─────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#131722" },
        textColor: "#d1d4dc",
      },
      grid: {
        vertLines: { color: "#1e222d" },
        horzLines: { color: "#1e222d" },
      },
      crosshair: { mode: 0 },
      timeScale: { timeVisible: true, secondsVisible: false },
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
    });

    const series = chart.addCandlestickSeries({
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderUpColor: "#26a69a",
      borderDownColor: "#ef5350",
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
    });

    chartRef.current = chart;
    seriesRef.current = series;

    // Resize observer
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      chart.applyOptions({ width, height });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // ─── Load historical data ─────────────────────────
  useEffect(() => {
    if (!seriesRef.current) return;

    fetchKlines({ exchange, symbol, interval, limit: 1000 })
      .then((klines) => {
        const data: CandlestickData[] = klines.map((k) => ({
          time: k.time as Time,
          open: k.open,
          high: k.high,
          low: k.low,
          close: k.close,
        }));
        seriesRef.current?.setData(data);
      })
      .catch(console.error);
  }, [exchange, symbol, interval]);

  // ─── Real-time kline subscription ──────────────────
  useEffect(() => {
    const klineChannel = `kline:${exchange}:${symbol}`;
    wsSubscribe([klineChannel]);

    const unsub = onKlineUpdate((ex, sym, data: KlineUpdate) => {
      if (ex !== exchange || sym !== symbol) return;
      seriesRef.current?.update({
        time: Math.floor(new Date(data.ts).getTime() / 1000) as Time,
        open: data.open,
        high: data.high,
        low: data.low,
        close: data.close,
      });
    });

    return () => {
      wsUnsubscribe([klineChannel]);
      unsub();
    };
  }, [exchange, symbol]);

  // ─── Fill markers ──────────────────────────────────
  useEffect(() => {
    if (!seriesRef.current) return;

    const relevantFills = fills.filter(
      (f) => f.exchange === exchange && f.symbol === symbol
    );

    const markers: SeriesMarker<Time>[] = relevantFills.map((f) => ({
      time: Math.floor(new Date(f.ts).getTime() / 1000) as Time,
      position: f.side === "BUY" ? "belowBar" : "aboveBar",
      color: f.side === "BUY" ? "#26a69a" : "#ef5350",
      shape: f.side === "BUY" ? "arrowUp" : "arrowDown",
      text: `${f.side} ${f.quantity}`,
    }));

    seriesRef.current.setMarkers(
      markers.sort((a, b) => (a.time as number) - (b.time as number))
    );
  }, [fills, exchange, symbol]);

  // ─── Subscribe to fills channel ────────────────────
  useEffect(() => {
    const fillChannel = `fill:${exchange}:${symbol}`;
    wsSubscribe([fillChannel]);
    return () => wsUnsubscribe([fillChannel]);
  }, [exchange, symbol]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%" }}
    />
  );
}
