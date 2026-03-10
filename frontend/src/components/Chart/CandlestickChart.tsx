/**
 * CandlestickChart — TradingView Lightweight Charts wrapper.
 *
 * - Loads historical data from REST API on mount
 * - Lazy-loads older data when user scrolls left (infinite history)
 * - Auto-triggers backfill via web-api if data is missing from DB
 * - Subscribes to real-time kline updates via WebSocket
 * - Gap-fill: detects holes in the live feed and fetches missing candles
 * - Volume histogram displayed in the bottom 25% of the chart
 * - Displays fill markers (triangles) on the chart
 */

import React, { useEffect, useRef, useState } from "react";
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
import type { ExchangeId, KlineUpdate, Fill, Kline } from "../../types";

interface Props {
  exchange: ExchangeId;
  symbol: string;
  interval: string;
}

// Bars from the left edge that trigger loading older data
const LOAD_TRIGGER_BARS = 50;

// Interval in seconds — used for gap detection in live feed
const INTERVAL_SECS: Record<string, number> = {
  "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400,
};

type VolumeBar = { time: Time; value: number; color: string };

// Module-level helpers (no component deps)
function toCandles(raw: Kline[]): CandlestickData[] {
  return raw.map((k) => ({ time: k.time as Time, open: k.open, high: k.high, low: k.low, close: k.close }));
}

function toVolumes(raw: Kline[]): VolumeBar[] {
  return raw.map((k) => ({
    time:  k.time as Time,
    value: k.volume ?? 0,
    color: k.close >= k.open ? "rgba(38,166,154,0.4)" : "rgba(239,83,80,0.4)",
  }));
}

export function CandlestickChart({ exchange, symbol, interval }: Props) {
  const containerRef   = useRef<HTMLDivElement>(null);
  const chartRef       = useRef<IChartApi | null>(null);
  const seriesRef      = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volSeriesRef   = useRef<ISeriesApi<"Histogram"> | null>(null);
  const fills = useTerminalStore((s) => s.fills);

  // Lazy loading state
  const allDataRef    = useRef<CandlestickData[]>([]);
  const allVolumeRef  = useRef<VolumeBar[]>([]);
  const oldestTsRef   = useRef<number | null>(null);
  const loadingRef    = useRef(false);
  const loadOlderRef  = useRef<(() => Promise<void>) | null>(null);
  const initialLoadedRef = useRef(false);
  const [isBackfilling, setIsBackfilling] = useState(false);

  // ─── Create chart + volume series on mount ───────────
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
      width:  containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
    });

    // Candlestick price scale — leaves bottom 25% for volume
    chart.priceScale("right").applyOptions({
      scaleMargins: { top: 0.05, bottom: 0.25 },
    });

    const series = chart.addCandlestickSeries({
      upColor:         "#26a69a",
      downColor:       "#ef5350",
      borderUpColor:   "#26a69a",
      borderDownColor: "#ef5350",
      wickUpColor:     "#26a69a",
      wickDownColor:   "#ef5350",
    });

    // Volume histogram — occupies the bottom 25%
    const volSeries = chart.addHistogramSeries({
      priceFormat:      { type: "volume" },
      priceScaleId:     "volume",
      lastValueVisible: false,
      priceLineVisible: false,
    } as any);

    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.75, bottom: 0 },
    });

    chartRef.current    = chart;
    seriesRef.current   = series;
    volSeriesRef.current = volSeries;

    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      chart.applyOptions({ width, height });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current    = null;
      seriesRef.current   = null;
      volSeriesRef.current = null;
    };
  }, []);

  // ─── Historical load + lazy-load on scroll ───────────
  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) return;

    allDataRef.current   = [];
    allVolumeRef.current = [];
    oldestTsRef.current  = null;
    loadingRef.current   = false;
    initialLoadedRef.current = false;
    setIsBackfilling(false);

    const setAllData = (candles: CandlestickData[], volumes: VolumeBar[]) => {
      seriesRef.current?.setData(candles);
      volSeriesRef.current?.setData(volumes);
    };

    const loadOlderData = async () => {
      if (loadingRef.current || oldestTsRef.current === null) return;
      loadingRef.current = true;

      const endIso = new Date((oldestTsRef.current - 1) * 1000).toISOString();
      try {
        const { data, backfill_triggered } = await fetchKlines({
          exchange, symbol, interval, end: endIso, limit: 1000,
        });

        if (data.length > 0) {
          const filtered = data.filter((k) => k.time < oldestTsRef.current!);
          if (filtered.length > 0) {
            const currentRange = chartRef.current?.timeScale().getVisibleLogicalRange();
            const prependCount = filtered.length;
            allDataRef.current   = [...toCandles(filtered), ...allDataRef.current];
            allVolumeRef.current = [...toVolumes(filtered), ...allVolumeRef.current];
            setAllData(allDataRef.current, allVolumeRef.current);
            oldestTsRef.current = filtered[0].time as number;
            if (currentRange) {
              chartRef.current?.timeScale().setVisibleLogicalRange({
                from: currentRange.from + prependCount,
                to:   currentRange.to   + prependCount,
              });
            }
          }
        }

        if (backfill_triggered) {
          setIsBackfilling(true);
        } else {
          loadingRef.current = false;
        }
      } catch (err) {
        console.error("loadOlderData error:", err);
        loadingRef.current = false;
      }
    };

    loadOlderRef.current = loadOlderData;

    // Initial historical fetch
    fetchKlines({ exchange, symbol, interval, limit: 1000 })
      .then(({ data, backfill_triggered }) => {
        const candles = toCandles(data);
        const volumes = toVolumes(data);
        allDataRef.current   = candles;
        allVolumeRef.current = volumes;
        setAllData(candles, volumes);
        if (candles.length > 0) oldestTsRef.current = candles[0].time as number;
        setIsBackfilling(backfill_triggered);
        initialLoadedRef.current = true;

        // Forward gap check: if newest DB candle is behind "now", immediately
        // fetch the missing range. This fills the gap between the last backfill
        // and the current live feed without waiting for a WebSocket event.
        if (candles.length > 0) {
          const newestTs = candles[candles.length - 1].time as number;
          const ivSecs   = INTERVAL_SECS[interval] ?? 60;
          const nowTs    = Math.floor(Date.now() / 1000);
          if (nowTs - newestTs > ivSecs) {
            fetchKlines({
              exchange, symbol, interval,
              start: new Date((newestTs + ivSecs) * 1000).toISOString(),
              limit: 500,
            }).then(({ data: fwd }) => {
              const newC = toCandles(fwd.filter(k => k.time > newestTs));
              const newV = toVolumes(fwd.filter(k => k.time > newestTs));
              if (newC.length > 0) {
                allDataRef.current   = [...allDataRef.current,   ...newC];
                allVolumeRef.current = [...allVolumeRef.current, ...newV];
                setAllData(allDataRef.current, allVolumeRef.current);
              }
            }).catch(console.error);
          }
        }
      })
      .catch(console.error);

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

  // ─── Backfill completion handler ─────────────────────
  useEffect(() => {
    const backfillChannel = `backfill:done:${exchange}:${symbol}`;
    wsSubscribe([backfillChannel]);

    // Helper: fetch candles newer than newestTs and append to chart
    const fillForwardGap = (newestTs: number) => {
      const ivSecs = INTERVAL_SECS[interval] ?? 60;
      const nowTs  = Math.floor(Date.now() / 1000);
      if (nowTs - newestTs <= ivSecs) return;
      fetchKlines({
        exchange, symbol, interval,
        start: new Date((newestTs + ivSecs) * 1000).toISOString(),
        limit: 500,
      }).then(({ data: fwd }) => {
        const newC = toCandles(fwd.filter(k => k.time > newestTs));
        const newV = toVolumes(fwd.filter(k => k.time > newestTs));
        if (newC.length > 0) {
          allDataRef.current   = [...allDataRef.current,   ...newC];
          allVolumeRef.current = [...allVolumeRef.current, ...newV];
          seriesRef.current?.setData(allDataRef.current);
          volSeriesRef.current?.setData(allVolumeRef.current);
        }
      }).catch(console.error);
    };

    const unsub = onBackfillDone((ex, sym) => {
      if (ex !== exchange || sym !== symbol) return;
      setIsBackfilling(false);
      loadingRef.current = false;

      if (oldestTsRef.current !== null) {
        // Load older data (for scroll-left history)
        loadOlderRef.current?.();
        // Also fill any forward gap between the current newest bar and now
        const newest = allDataRef.current[allDataRef.current.length - 1];
        if (newest) fillForwardGap(newest.time as number);
      } else {
        // No data at all — do a full reload
        fetchKlines({ exchange, symbol, interval, limit: 1000 })
          .then(({ data }) => {
            const candles = toCandles(data);
            const volumes = toVolumes(data);
            allDataRef.current   = candles;
            allVolumeRef.current = volumes;
            seriesRef.current?.setData(candles);
            volSeriesRef.current?.setData(volumes);
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

  // ─── Real-time kline subscription ────────────────────
  // Only for 1m: applying raw 1m ticks to higher-interval charts causes
  // wrong timestamps and flickering. Higher intervals rely on DB data.
  useEffect(() => {
    if (interval !== "1m") return;

    const klineChannel = `kline:${exchange}:${symbol}`;
    wsSubscribe([klineChannel]);

    const intervalSecs = INTERVAL_SECS[interval] ?? 60;

    const unsub = onKlineUpdate((ex, sym, data: KlineUpdate) => {
      if (ex !== exchange || sym !== symbol) return;

      const candleTime = Math.floor(new Date(data.ts).getTime() / 1000) as Time;
      const candle: CandlestickData = {
        time: candleTime, open: data.open, high: data.high, low: data.low, close: data.close,
      };
      const volBar: VolumeBar = {
        time:  candleTime,
        value: data.volume ?? 0,
        color: data.close >= data.open ? "rgba(38,166,154,0.4)" : "rgba(239,83,80,0.4)",
      };

      // Gap detection: if incoming candle is >1.5 intervals ahead of the last
      // known bar, fetch the missing candles before applying the live update.
      const last = allDataRef.current[allDataRef.current.length - 1];
      const lastTime = last ? (last.time as number) : null;
      const gapExists = lastTime !== null && (candleTime as number) - lastTime > intervalSecs * 1.5;

      if (gapExists && !loadingRef.current) {
        loadingRef.current = true;
        const gapStartIso = new Date((lastTime! + intervalSecs) * 1000).toISOString();
        const gapEndIso   = new Date((candleTime as number) * 1000).toISOString();

        fetchKlines({ exchange, symbol, interval, start: gapStartIso, end: gapEndIso, limit: 500 })
          .then(({ data: gapData }) => {
            if (gapData.length > 0) {
              const newCandles = gapData
                .filter((k) => k.time > lastTime!)
                .map((k) => ({ time: k.time as Time, open: k.open, high: k.high, low: k.low, close: k.close }));
              const newVols = gapData
                .filter((k) => k.time > lastTime!)
                .map((k) => ({
                  time:  k.time as Time,
                  value: k.volume ?? 0,
                  color: k.close >= k.open ? "rgba(38,166,154,0.4)" : "rgba(239,83,80,0.4)",
                }));
              allDataRef.current   = [...allDataRef.current, ...newCandles];
              allVolumeRef.current = [...allVolumeRef.current, ...newVols];
              seriesRef.current?.setData(allDataRef.current);
              volSeriesRef.current?.setData(allVolumeRef.current);
            }
          })
          .catch(console.error)
          .finally(() => { loadingRef.current = false; });
      }

      // Apply live update to both series
      seriesRef.current?.update(candle);
      volSeriesRef.current?.update(volBar);

      // Keep allDataRef in sync
      if (last && (last.time as number) === (candleTime as number)) {
        allDataRef.current[allDataRef.current.length - 1] = candle;
        allVolumeRef.current[allVolumeRef.current.length - 1] = volBar;
      } else if (!last || (last.time as number) < (candleTime as number)) {
        allDataRef.current.push(candle);
        allVolumeRef.current.push(volBar);
      }
    });

    return () => {
      wsUnsubscribe([klineChannel]);
      unsub();
    };
  }, [exchange, symbol, interval]);

  // ─── Fill markers ─────────────────────────────────────
  useEffect(() => {
    if (!seriesRef.current) return;

    const relevantFills = fills.filter(
      (f) => f.exchange === exchange && f.symbol === symbol
    );

    const markers: SeriesMarker<Time>[] = relevantFills.map((f) => ({
      time:     Math.floor(new Date(f.ts).getTime() / 1000) as Time,
      position: f.side === "BUY" ? "belowBar" : "aboveBar",
      color:    f.side === "BUY" ? "#26a69a" : "#ef5350",
      shape:    f.side === "BUY" ? "arrowUp"  : "arrowDown",
      text:     `${f.side} ${f.quantity}`,
    }));

    seriesRef.current.setMarkers(
      markers.sort((a, b) => (a.time as number) - (b.time as number))
    );
  }, [fills, exchange, symbol]);

  // ─── Subscribe to fills channel ───────────────────────
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
