import "server-only";
import { config } from "@/lib/config";
import { getJson } from "@/lib/sources/http";
import type { ControlStatus, Job, JobAction, LogLine } from "@/lib/types";

// Client for the control API in the client container (scripts/control_server.py).

export const JOB_ACTIONS: readonly JobAction[] = [
  "ingest-flume", "ingest-kafka", "ingest-sqoop", "ingest-parallel", "verify-ingestion", "replay", "pipeline", "counts", "hive-tables", "sqoop-import", "hive-analysis", "sqoop-export",
];
export const REPLAY_RATES = [1000, 2000, 5000, 10000] as const;

export interface StartJobRequest {
  action: JobAction;
  rate?: number;
  limit?: number;
}

/** Error carrying the control API's status and message, passed through to the browser. */
export class ControlError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function fetchControlStatus(): Promise<ControlStatus> {
  return getJson<ControlStatus>(`${config.controlUrl}/status`);
}

export function fetchJobLog(jobId: string, after: number): Promise<{ job: Job; lines: LogLine[] }> {
  return getJson(`${config.controlUrl}/jobs/${encodeURIComponent(jobId)}/log?after=${after}`);
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${config.controlUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new ControlError(response.status, payload.error ?? "request failed");
  return payload;
}

export const startJob = (request: StartJobRequest) => post<Job>("/jobs", request);

export const cancelJob = (jobId: string) => post<Job>(`/jobs/${encodeURIComponent(jobId)}/cancel`);
