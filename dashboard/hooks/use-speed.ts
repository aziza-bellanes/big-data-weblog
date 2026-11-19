"use client";

import { useEffect, useState } from "react";
import type { SpeedSnapshot } from "@/lib/types";

const POLL_INTERVAL_MS = 5000;

export interface SpeedState {
  data: SpeedSnapshot | null;
  /** Why the last poll failed: the speed layer tables are not readable, or the server is not reachable. */
  error: string | null;
}

/** Poll /api/speed, the speed layer's serving tables in MySQL, every five seconds (one Spark micro-batch). */
export function useSpeed(): SpeedState {
  const [state, setState] = useState<SpeedState>({ data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const response = await fetch("/api/speed", { cache: "no-store" });
        const body = (await response.json()) as SpeedSnapshot & { error?: string };
        if (!response.ok) throw new Error(body.error ?? String(response.status));
        if (!cancelled) setState({ data: body, error: null });
      } catch (error) {
        const message = error instanceof Error ? error.message : "The dashboard server is not reachable.";
        if (!cancelled) setState((s) => ({ ...s, error: message }));
      } finally {
        if (!cancelled) timer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return state;
}
