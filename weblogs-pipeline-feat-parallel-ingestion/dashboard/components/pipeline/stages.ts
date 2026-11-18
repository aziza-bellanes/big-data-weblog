import {
  ArrowLeftRight,
  Cpu,
  Database,
  HardDrive,
  Layers,
  Send,
  type LucideIcon,
} from "lucide-react";
import type { Rates } from "@/hooks/use-pipeline";
import { formatBytes, formatCompact, formatInt } from "@/lib/format";
import type { PipelineSnapshot, StageState } from "@/lib/types";

export interface Stage {
  key: string;
  tool: string;
  role: string;
  icon: LucideIcon;
  state: StageState;
  metric: number;
  formatMetric: (value: number) => string;
  metricLabel: string;
  details: { label: string; value: string }[];
  /** Optional progress bar (0-100), e.g. replay progress or a running MapReduce job. */
  progress?: { value: number; label: string };
}

/** The link between two stages: whether data is moving and how fast. */
export interface Connector {
  active: boolean;
  label: string;
  /** Lines per second, used to speed up the animation; 0 when unknown. */
  rate: number;
}

export interface Flow {
  stages: Stage[];
  /** connectors[i] links stages[i] to stages[i + 1]. */
  connectors: Connector[];
}

const perSecond = (rate: number) => `${formatInt(rate)}/s`;

/** A stage is "active" while data flows through it, not only while it holds a backlog. */
const flowing = (state: StageState, rate: number): StageState =>
  state === "down" ? "down" : rate > 0 ? "active" : state;

/** Ordered pipeline stages and the connectors between them, built from one snapshot. */
export function buildFlow(s: PipelineSnapshot, rates: Rates): Flow {
  const job = s.control?.current;
  const runningStep = job?.steps.find((step) => step.status === "running")?.key;
  const runningApp = s.yarn.recent.find((app) => app.state === "RUNNING");
  const exporting = runningStep === "sqoop-export";
  const importing = !!s.control?.active?.some(j => ["sqoop-import", "ingest-sqoop", "ingest-parallel"].includes(j.action));
  const lastImport = s.control?.history.find(j => ["sqoop-import", "ingest-sqoop"].includes(j.action));

  const stages: Stage[] = [
    {
      key: "agent1",
      tool: "Flume → HDFS",
      role: "TAILDIR → /data/nasa/raw/flume",
      icon: Send,
      state: flowing(s.agent1.state, rates.agent1),
      metric: s.agent1.eventsOut,
      formatMetric: formatCompact,
      metricLabel: "events sent",
      details: [
        { label: "Rate", value: perSecond(rates.agent1) },
        { label: "Channel", value: formatInt(s.agent1.channelSize) },
      ],
    },
    {
      key: "kafka",
      tool: "Kafka → HDFS",
      role: `${s.kafka.topic} · ${s.kafka.partitions} partitions`,
      icon: Layers,
      state: flowing(s.kafka.state, rates.kafka),
      metric: s.kafka.messages,
      formatMetric: formatCompact,
      metricLabel: s.kafka.state === "down" ? "unavailable" : "messages in topic",
      details: [
        { label: "HDFS writer", value: s.agent2.state === "down" ? "unavailable" : formatInt(s.agent2.eventsOut) + " this session" },
        { label: "Lag", value: s.kafka.state === "down" ? "unknown" : formatInt(s.kafka.consumerLag) },
      ],
    },
    {
      key: "sqoop-import", tool: "Sqoop import → HDFS", role: "MySQL status_codes → reference/sqoop",
      icon: Database, state: !s.control || (!importing && lastImport?.status === "failed") ? "down" : importing ? "active" : "idle",
      metric: 0, formatMetric: () => importing ? "Running" : !s.control ? "Unknown" : "Batch",
      metricLabel: "reference snapshot; verify for row counts",
      details: [{ label: "Last job", value: lastImport?.status ?? "unknown" }],
    },
    {
      key: "hdfs",
      tool: "HDFS",
      role: "Canonical raw zone: /data/nasa/raw/flume",
      icon: HardDrive,
      state: flowing(s.hdfs.state, rates.agent2),
      metric: s.hdfs.partitions,
      formatMetric: formatInt,
      metricLabel: "partitions (dt=…)",
      details: [
        { label: "Size", value: formatBytes(s.hdfs.bytes) },
        { label: "Open files", value: formatInt(s.hdfs.openFiles) },
      ],
    },
    {
      key: "hive",
      tool: "Hive on YARN",
      role: "HiveQL → MapReduce",
      icon: Cpu,
      state: s.yarn.state,
      metric: s.yarn.completed,
      formatMetric: formatInt,
      metricLabel: "jobs succeeded",
      details: [
        { label: "Running", value: formatInt(s.yarn.running) },
        { label: "Failed", value: formatInt(s.yarn.failed) },
      ],
      progress: runningApp ? { value: runningApp.progress, label: runningApp.name } : undefined,
    },
    {
      key: "sqoop",
      tool: "Sqoop export",
      role: "Hive results → MySQL",
      icon: ArrowLeftRight,
      state: s.mysql.state === "down" ? "down" : exporting || importing ? "active" : "idle",
      metric: s.mysql.resultRows,
      formatMetric: formatInt,
      metricLabel: "result rows in MySQL",
      details: [{ label: "Now", value: exporting ? "exporting" : importing ? "importing" : "waiting" }],
    },
    {
      key: "mysql",
      tool: "MySQL",
      role: "results + status_codes",
      icon: Database,
      // Results only move while Sqoop exports them, so a reachable database reads as idle.
      state: s.mysql.state === "down" ? "down" : exporting ? "active" : "idle",
      metric: s.mysql.resultRows > 0 ? 6 : 0,
      formatMetric: formatInt,
      metricLabel: "result tables filled",
      details: [{ label: "Read by", value: "this dashboard" }],
    },
  ];

  return { stages, connectors: [] };
}
