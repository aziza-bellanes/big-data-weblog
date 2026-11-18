import { formatBytes, formatDuration, formatInt } from "@/lib/format";
import type { ArchName, ArchRun, RunRecord } from "@/lib/types";

// How a comparison record (scripts/runs.py, control API /runs) is read and judged.

export const ARCH_ORDER: readonly ArchName[] = ["sequential", "parallel"];
export const ARCH_COLORS: Record<ArchName, string> = { sequential: "var(--chart-2)", parallel: "var(--chart-1)" };

const seconds = (value: number) => formatDuration(value * 1000);

export interface Metric {
  label: string;
  hint: string;
  value: (run: ArchRun) => number | null | undefined;
  format: (value: number) => string;
  /** Which value wins; null when the metric is context, not a score. */
  better: "lower" | "higher" | null;
}

/** Sum of every step of one architecture: from the first replayed line to the MySQL export. */
export function endToEndSeconds(run: ArchRun): number | null {
  const values = Object.values(run.steps);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

export const METRICS: Metric[] = [
  { label: "Lines ingested", hint: "Replayed into the live log", value: (r) => r.ingestion?.lines, format: formatInt, better: null },
  { label: "Every line in HDFS", hint: "From the first replayed line", value: (r) => r.ingestion?.allWrittenSeconds, format: seconds, better: "lower" },
  { label: "Every file closed", hint: "Readable by Hive", value: (r) => r.ingestion?.allClosedSeconds, format: seconds, better: "lower" },
  { label: "Ingestion throughput", hint: "Lines per second into HDFS", value: (r) => r.ingestion?.linesPerSecond, format: (v) => `${formatInt(v)}/s`, better: "higher" },
  { label: "Peak Kafka lag", hint: "Messages waiting for the HDFS writer", value: (r) => r.ingestion?.peakKafkaLag, format: formatInt, better: "lower" },
  { label: "Raw files in HDFS", hint: "Fewer, larger files suit HDFS", value: (r) => r.ingestion?.raw?.files, format: formatInt, better: "lower" },
  { label: "Average raw file", hint: "Size of one HDFS file", value: (r) => r.ingestion?.raw?.avgFileBytes, format: formatBytes, better: "higher" },
  { label: "Batch part", hint: "Hive and Sqoop steps", value: (r) => r.batchSeconds, format: seconds, better: "lower" },
  { label: "Replay to MySQL", hint: "Every step, end to end", value: endToEndSeconds, format: seconds, better: "lower" },
];

/** The winning architecture for one metric, or null for a tie (within 2 %) or missing values. */
export function winner(metric: Metric, record: RunRecord): ArchName | null {
  if (!metric.better) return null;
  const [a, b] = ARCH_ORDER.map((arch) => {
    const run = record.architectures[arch];
    return run ? metric.value(run) : null;
  });
  if (a == null || b == null || Math.abs(a - b) <= 0.02 * Math.max(Math.abs(a), Math.abs(b))) return null;
  const aWins = metric.better === "lower" ? a < b : a > b;
  return aWins ? "sequential" : "parallel";
}

/** Phases timed in both architectures, in pipeline order, for the duration chart. */
export const PHASES: { label: string; keys: string[] }[] = [
  { label: "Ingestion", keys: ["replay"] },
  { label: "No-loss check", keys: ["counts"] },
  { label: "Hive tables", keys: ["hive-tables"] },
  { label: "Import / branch check", keys: ["sqoop-import", "verify-ingestion"] },
  { label: "Hive analysis", keys: ["hive-analysis"] },
  { label: "Sqoop export", keys: ["sqoop-export"] },
];
