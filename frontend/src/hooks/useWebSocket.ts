/**
 * Central WebSocket hook — manages a single connection to web-api.
 *
 * Handles:
 *   - Auto-connect with exponential backoff
 *   - Channel subscription management
 *   - Dispatching incoming messages to the store
 */

import { useEffect, useRef, useCallback } from "react";
import { useTerminalStore } from "../stores/terminalStore";
import type { Fill, KlineUpdate } from "../types";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8000/ws";

// Singleton event emitter for kline updates (avoids store churn)
type KlineListener = (exchange: string, symbol: string, data: KlineUpdate) => void;
const klineListeners = new Set<KlineListener>();

export function onKlineUpdate(listener: KlineListener): () => void {
  klineListeners.add(listener);
  return () => klineListeners.delete(listener);
}

let ws: WebSocket | null = null;
let subscribedChannels = new Set<string>();

export function wsSubscribe(channels: string[]) {
  const newChannels = channels.filter((c) => !subscribedChannels.has(c));
  if (newChannels.length === 0) return;
  newChannels.forEach((c) => subscribedChannels.add(c));
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ action: "subscribe", channels: newChannels }));
  }
}

export function wsUnsubscribe(channels: string[]) {
  channels.forEach((c) => subscribedChannels.delete(c));
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ action: "unsubscribe", channels }));
  }
}

export function useWebSocket() {
  const setWsConnected = useTerminalStore((s) => s.setWsConnected);
  const addFill = useTerminalStore((s) => s.addFill);
  const retryDelay = useRef(1000);

  const connect = useCallback(() => {
    if (ws?.readyState === WebSocket.OPEN) return;

    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      setWsConnected(true);
      retryDelay.current = 1000;
      // Re-subscribe existing channels on reconnect
      if (subscribedChannels.size > 0) {
        ws!.send(JSON.stringify({
          action: "subscribe",
          channels: Array.from(subscribedChannels),
        }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const { channel, data } = msg as { channel: string; data: any };

        if (channel.startsWith("kline:")) {
          // Parse channel: kline:{exchange}:{symbol}
          const parts = channel.split(":");
          const exchange = parts[1];
          const symbol = parts[2];
          klineListeners.forEach((fn) => fn(exchange, symbol, data));
        } else if (channel.startsWith("fill:")) {
          addFill(data as Fill);
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      setWsConnected(false);
      // Exponential backoff reconnect
      setTimeout(() => {
        retryDelay.current = Math.min(retryDelay.current * 2, 30000);
        connect();
      }, retryDelay.current);
    };

    ws.onerror = () => {
      ws?.close();
    };
  }, [setWsConnected, addFill]);

  useEffect(() => {
    connect();
    return () => {
      ws?.close();
      ws = null;
    };
  }, [connect]);
}
