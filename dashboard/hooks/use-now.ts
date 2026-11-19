"use client";

import { useCallback, useSyncExternalStore } from "react";

const DEFAULT_TICK_MS = 1000;

/**
 * Current time in ms, refreshed every `intervalMs` (no timer when null), for live durations.
 * The value is rounded to the interval so React sees a stable snapshot between ticks, and it is
 * 0 on the server, where pages are prerendered without a clock.
 */
export function useNow(intervalMs: number | null): number {
  const tick = intervalMs ?? DEFAULT_TICK_MS;
  const subscribe = useCallback(
    (onTick: () => void) => {
      if (intervalMs === null) return () => {};
      const timer = setInterval(onTick, intervalMs);
      return () => clearInterval(timer);
    },
    [intervalMs],
  );
  return useSyncExternalStore(
    subscribe,
    () => Math.floor(Date.now() / tick) * tick,
    () => 0,
  );
}
