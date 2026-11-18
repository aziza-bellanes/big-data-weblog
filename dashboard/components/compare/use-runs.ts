"use client";

import { useEffect, useState } from "react";
import type { RunRecord } from "@/lib/types";

export interface RunsState {
  comparisons: RunRecord[];
  /** Latest comparison with its progress samples, for the charts. */
  latest: RunRecord | null;
  loading: boolean;
  error: string | null;
}

/**
 * Recorded comparisons from the control API. Reloaded whenever `version` changes (the page
 * passes the id of the last finished job, so a comparison that ends appears at once).
 */
export function useRuns(version: string | null): RunsState {
  const [state, setState] = useState<RunsState>({ comparisons: [], latest: null, loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/runs", { cache: "no-store" });
        if (!response.ok) throw new Error("The control service in the client container is not reachable.");
        const { runs } = (await response.json()) as { runs: RunRecord[] };
        const comparisons = runs.filter((run) => run.kind === "comparison");
        const newest = comparisons.find((run) => run.status === "succeeded" || run.comparison) ?? comparisons[0];
        const latest = newest
          ? ((await (await fetch(`/api/runs/${newest.id}`, { cache: "no-store" })).json()) as RunRecord)
          : null;
        if (!cancelled) setState({ comparisons, latest, loading: false, error: null });
      } catch (error) {
        if (!cancelled) setState((s) => ({ ...s, loading: false, error: error instanceof Error ? error.message : "Unavailable" }));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [version]);

  return state;
}
