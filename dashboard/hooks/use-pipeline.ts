"use client";

import { useEffect, useRef, useState } from "react";
import type { PipelineSnapshot } from "@/lib/types";

const POLL_INTERVAL_MS = 2000;
/** Samples kept for the live charts: 90 × 2 s = the last three minutes. */
const HISTORY_SIZE = 90;

export interface Rates {
  replay: number;
  agent1: number;
  kafka: number;
  agent2: number;
}

export interface Sample extends Rates {
  takenAt: number;
  consumerLag: number;
}

export interface PipelineState {
  snapshot: PipelineSnapshot | null;
  rates: Rates;
  history: Sample[];
  /** True when the dashboard's own API could not be reached on the last poll. */
  offline: boolean;
  /** Fetch a fresh snapshot now, e.g. right after starting a job. */
  refresh: () => void;
}

const ZERO_RATES: Rates = { replay: 0, agent1: 0, kafka: 0, agent2: 0 };

function ratesBetween(previous: PipelineSnapshot, current: PipelineSnapshot): Rates {
  const seconds = (current.takenAt - previous.takenAt) / 1000;
  if (seconds <= 0) return ZERO_RATES;
  const perSecond = (now: number, before: number) => Math.max(0, (now - before) / seconds);
  return {
    replay: perSecond(current.replay.linesWritten, previous.replay.linesWritten),
    agent1: perSecond(current.agent1.eventsOut, previous.agent1.eventsOut),
    kafka: perSecond(current.kafka.messages, previous.kafka.messages),
    agent2: perSecond(current.agent2.eventsOut, previous.agent2.eventsOut),
  };
}

/** Poll /api/pipeline, derive per-stage throughput and keep a short history for charts. */
export function usePipeline(): PipelineState {
  const [state, setState] = useState<Omit<PipelineState, "refresh">>({
    snapshot: null,
    rates: ZERO_RATES,
    history: [],
    offline: false,
  });
  const previous = useRef<PipelineSnapshot | null>(null);
  const pollNow = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      clearTimeout(timer);
      try {
        const response = await fetch("/api/pipeline", { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const snapshot = (await response.json()) as PipelineSnapshot;
        if (cancelled) return;
        const rates = previous.current ? ratesBetween(previous.current, snapshot) : ZERO_RATES;
        previous.current = snapshot;
        const sample: Sample = { takenAt: snapshot.takenAt, consumerLag: snapshot.kafka.consumerLag, ...rates };
        setState((s) => ({
          snapshot,
          rates,
          history: [...s.history, sample].slice(-HISTORY_SIZE),
          offline: false,
        }));
      } catch {
        if (!cancelled) setState((s) => ({ ...s, offline: true }));
      } finally {
        if (!cancelled) timer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    }

    pollNow.current = () => void poll();
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return { ...state, refresh: () => pollNow.current() };
}
