/**
 * CandlestickChart — TradingView Lightweight Charts wrapper.
 *
 * - Loads historical data from REST API on mount
 * - Lazy-loads older data when user scrolls left (infinite history)
 * - Auto-triggers backfill via web-api if data is missing from DB
 * - Subscribes to real-time kline updates via WebSocket
 * - Displays fill markers (triangles) on the chart
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
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
import { onKlineUpdate, onBackfillDone, wsSubscribe, wsUnsubscribe } from "../../hooks/useWebSocket";
import { useTerminalStore } from "../../stores/terminalStore";
import type { ExchangeId, KlineUpdate, Fill } from "../../types";

interface Props {
  exchange: ExchangeId;
  symbol: string;
  interval: string;
}

// How many bars from the left edge triggers loading older data
const LOAD_TRIGGER_BARS = 50;

export function CandlestickChart({ exchange, symbol, interval }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const fills = useTerminalStore((s) => s.fills);

  // Lazy loading state
  const allDataRef = useRef<CandlestickData[]>([]);
  const oldestTsRef = useRef<number | null>(null);
  const loadingRef = useRef(false);
  const loadOlderRef = useRef<(() => Promise<void>) | null>(null);
  const initialLoadedRef = useRef(false);   // blocks range handler until first setData completes
  const [isBackfilling, setIsBackfilling] = useState(false);

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

  // ─── Historical load + lazy load on scroll ─────────
  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;

    // Reset on symbol/interval change
    allDataRef.current = [];
    oldestTsRef.current = null;
    loadingRef.current = false;
    initialLoadedRef.current = false;
    setIsBackfilling(false);

    const toCandles = (raw: { time: number; open: number; high: number; low: number; close: number }[]): CandlestickData[] =>
      raw.map((k) => ({ time: k.time as Time, open: k.open, high: k.high, low: k.low, close: k.close }));

    // Load data older than current oldest timestamp
    const loadOlderData = async () => {
      if (loadingRef.current || oldestTsRef.current === null) return;
      loadingRef.current = true;

      const endIso = new Date((oldestTsRef.current - 1) * 1000).toISOString();
      try {
        const { data, backfill_triggered } = await fetchKlines({
          exchange, symbol, interval, end: endIso, limit: 1000,
        });

        if (data.length > 0) {
          const newCandles = toCandles(data.filter((k) => k.time < oldestTsRef.current!));
          if (newCandles.length > 0) {
            // Preserve scroll position — setData resets the visible range
            const currentRange = chartRef.current?.timeScale().getVisibleLogicalRange();
            const prependCount = newCandles.length;
            allDataRef.current = [...newCandles, ...allDataRef.current];
            seriesRef.current?.setData(allDataRef.current);
            oldestTsRef.current = newCandles[0].time as number;
            // Shift logical range by the number of prepended candles
            if (currentRange) {
              chartRef.current?.timeScale().setVisibleLogicalRange({
                from: currentRange.from + prependCount,
                to: currentRange.to + prependCount,
              });
            }
          }
        }

        if (backfill_triggered) {
          setIsBackfilling(true);
          // keep loadingRef.current = true while waiting for backfill:done
        } else {
          loadingRef.current = false;
        }
      } catch (err) {
        console.error("loadOlderData error:", err);
        loadingRef.current = false;
      }
    };

    // Expose so backfill:done handler can call it
    loadOlderRef.current = loadOlderData;

    // Initial historical fetch — set initialLoadedRef AFTER setData so range
    // handler doesn't fire during the brief transition before the chart settles.
    fetchKlines({ exchange, symbol, interval, limit: 1000 })
      .then(({ data, backfill_triggered }) => {
        const candles = toCandles(data);
        allDataRef.current = candles;
        seriesRef.current?.setData(candles);
        if (candles.length > 0) {
          oldestTsRef.current = candles[0].time as number;
        }
        setIsBackfilling(backfill_triggered);
        // Allow lazy-load range handler to fire only after initial data is displayed
        initialLoadedRef.current = true;
      })
      .catch(console.error);

    // Subscribe to logical range changes to detect left-edge scrolling.
    // Guard: skip until initial load finishes to avoid premature trigger when
    // setData briefly shows range.from = 0 before the chart right-aligns.
    const handleRangeChange = (range: { from: number; to: number } | null) => {
      if (!range || !initialLoadedRef.current || loadingRef.current || oldestTsRef.current === null) return;
      if (range.from < LOAD_TRIGGER_BARS) {
        loadOlderData();
      }
    };

    chartRef.current.timeScale().subscribeVisibleLogicalRangeChange(handleRangeChange);
    return () => {
      chartRef.current?.timeScale().unsubscribeVisibleLogicalRangeChange(handleRangeChange);
    };
  }, [exchange, symbol, interval]);

  // ─── Backfill completion handler ───────────────────
  useEffect(() => {
    const backfillChannel = `backfill:done:${exchange}:${symbol}`;
    wsSubscribe([backfillChannel]);

    const unsub = onBackfillDone((ex, sym) => {
      if (ex !== exchange || sym !== symbol) return;

      setIsBackfilling(false);
      loadingRef.current = false;

      if (oldestTsRef.current !== null) {
        // Fetch older data that was just backfilled
        loadOlderRef.current?.();
      } else {
        // Initial load was empty — refetch from scratch
        fetchKlines({ exchange, symbol, interval, limit: 1000 })
          .then(({ data }) => {
            const candles = data.map((k) => ({
              time: k.time as Time, open: k.open, high: k.high, low: k.low, close: k.close,
            }));
            allDataRef.current = candles;
            seriesRef.current?.setData(candles);
            if (candles.length > 0) oldestTsRef.current = candles[0].time as number;
          })
          .catch(console.error);
      }
    });

    return () => {
      wsUnsubscribe([backfillChannel]);
      unsub();
    };
  }, [exchange, symbol, interval]);

  // ─── Real-time kline subscription ──────────────────
  // Only apply live 1m updates when the chart is showing 1m interval.
  // Higher intervals use DB aggregates; applying raw 1m ticks to them
  // causes flickering and incorrect candle timestamps.
  useEffect(() => {
    if (interval !== "1m") return;

    const klineChannel = `kline:${exchange}:${symbol}`;
    wsSubscribe([klineChannel]);

    const unsub = onKlineUpdate((ex, sym, data: KlineUpdate) => {
      if (ex !== exchange || sym !== symbol) return;
      const candle = {
        time: Math.floor(new Date(data.ts).getTime() / 1000) as Time,
        open: data.open,
        high: data.high,
        low: data.low,
        close: data.close,
      };
      seriesRef.current?.update(candle);
      // Keep allDataRef in sync with the latest candle
      const last = allDataRef.current[allDataRef.current.length - 1];
      if (last && (last.time as number) === (candle.time as number)) {
        allDataRef.current[allDataRef.current.length - 1] = candle;
      } else if (!last || (last.time as number) < (candle.time as number)) {
        allDataRef.current.push(candle);
      }
    });

    return () => {
      wsUnsubscribe([klineChannel]);
      unsub();
    };
  }, [exchange, symbol, interval]);

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
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      {isBackfilling && (
        <div
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            background: "rgba(19, 23, 34, 0.88)",
            color: "#d1d4dc",
            padding: "3px 10px",
            borderRadius: 4,
            fontSize: 11,
            pointerEvents: "none",
            border: "1px solid #2a2e39",
            letterSpacing: "0.02em",
          }}
        >
          ↺ Loading history…
        </div>
      )}
    </div>
  );
}
