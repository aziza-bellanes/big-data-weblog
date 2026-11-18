"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { usePipeline, type PipelineState } from "@/hooks/use-pipeline";
import type { ArchName, JobAction } from "@/lib/types";

export interface JobRequest {
  action: JobAction;
  /** Defaults to the architecture selected with the switch; a comparison runs both. */
  arch?: ArchName;
  rate?: number;
  limit?: number;
  fresh?: boolean;
}

interface PipelineContextValue extends PipelineState {
  /** A start or cancel request is in flight. */
  busy: boolean;
  startJob: (request: JobRequest) => Promise<void>;
  cancelJob: (jobId: string) => Promise<void>;
}

const PipelineContext = createContext<PipelineContextValue | null>(null);

export const ACTION_LABELS: Record<JobAction, string> = {
  replay: "Ingestion",
  pipeline: "Batch pipeline",
  counts: "No-loss check",
  reset: "Reset",
  compare: "Comparison",
  "hive-tables": "Create Hive tables",
  "sqoop-import": "Sqoop import",
  "hive-analysis": "Hive analysis",
  "sqoop-export": "Sqoop export",
  "ingest-flume": "Flume branch",
  "ingest-kafka": "Kafka branch",
  "ingest-sqoop": "Sqoop branch",
  "verify-ingestion": "Branch check",
};

async function post(url: string, body: unknown): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const { error } = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(error ?? `request failed (${response.status})`);
  }
}

/** One poller shared by every live component on the page, plus the job controls. */
export function PipelineProvider({ children }: { children: ReactNode }) {
  const pipeline = usePipeline();
  const [busy, setBusy] = useState(false);
  const { refresh } = pipeline;

  const run = useCallback(
    async (task: () => Promise<void>, success: string, failure: string) => {
      setBusy(true);
      try {
        await task();
        toast.success(success);
      } catch (error) {
        toast.error(failure, { description: error instanceof Error ? error.message : undefined });
      } finally {
        setBusy(false);
        refresh();
      }
    },
    [refresh],
  );

  const startJob = useCallback(
    (request: JobRequest) =>
      run(() => post("/api/jobs", request), `${ACTION_LABELS[request.action]} started`, "Could not start the job"),
    [run],
  );
  const cancelJob = useCallback(
    (jobId: string) => run(() => post(`/api/jobs/${jobId}/cancel`, {}), "Stopping the job", "Could not stop the job"),
    [run],
  );

  return (
    <PipelineContext.Provider value={{ ...pipeline, busy, startJob, cancelJob }}>{children}</PipelineContext.Provider>
  );
}

export function usePipelineContext(): PipelineContextValue {
  const value = useContext(PipelineContext);
  if (!value) throw new Error("usePipelineContext must be used inside <PipelineProvider>");
  return value;
}
