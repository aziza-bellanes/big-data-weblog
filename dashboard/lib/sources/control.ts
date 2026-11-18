import "server-only";
import { config } from "@/lib/config";
import { getJson } from "@/lib/sources/http";
import type { ArchName, ControlStatus, Job, JobAction, LogLine, RunRecord } from "@/lib/types";

// Client for the control API in the client container (scripts/control_server.py).

export const JOB_ACTIONS: readonly JobAction[] = [
  "replay", "pipeline", "counts", "reset", "compare",
  "hive-tables", "sqoop-import", "hive-analysis", "sqoop-export",
  "ingest-flume", "ingest-kafka", "ingest-sqoop", "verify-ingestion",
];
/** Actions that take a rate and a line limit. */
export const RATED_ACTIONS: readonly JobAction[] = ["replay", "compare", "ingest-flume", "ingest-kafka"];
export const REPLAY_RATES = [1000, 2000, 5000, 10000, 20000] as const;

export interface StartJobRequest {
  action: JobAction;
  /** Omitted for a comparison, which runs both architectures. */
  arch?: ArchName;
  rate?: number;
  limit?: number;
  /** Comparison only: empty both architectures first. */
  fresh?: boolean;
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

export const fetchRuns = () => getJson<{ runs: RunRecord[] }>(`${config.controlUrl}/runs`);

export const fetchRun = (id: string) =>
  getJson<RunRecord>(`${config.controlUrl}/runs/${encodeURIComponent(id)}`);
