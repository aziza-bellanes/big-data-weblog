import {
  ArrowLeftRight,
  Zap,
  Cpu,
  Database,
  DatabaseZap,
  FileText,
  HardDrive,
  Layers,
  Monitor,
  Send,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { Rates } from "@/hooks/use-pipeline";
import { formatBytes, formatCompact, formatDuration, formatInt } from "@/lib/format";
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

/** A link between two stages: whether data is moving and how fast. */
export interface Connector {
  active: boolean;
  label: string;
  /** Lines per second, used to speed up the animation; 0 when unknown. */
  rate: number;
}

export type Direction = "forward" | "down" | "backward";

/**
 * One diagram, as items in reading order (the order used on narrow screens). `place` holds the
 * grid classes that position the item on wide screens.
 */
export type FlowItem =
  | { type: "lane"; label: string; place: string }
  | { type: "stage"; stage: Stage; place: string }
  | { type: "link"; connector: Connector; direction: Direction; place: string };

export interface Flow {
  /** Grid template on wide screens. */
  grid: string;
  items: FlowItem[];
}

const perSecond = (rate: number) => `${formatInt(rate)}/s`;

/** A stage is "active" while data flows through it, not only while it holds a backlog. */
const flowing = (state: StageState, rate: number): StageState =>
  state === "down" ? "down" : rate > 0 ? "active" : state;

const stream = (rate: number): Connector => ({
  active: rate > 0,
  label: rate > 0 ? perSecond(rate) : "idle",
  rate,
});

const signal = (active: boolean, label: string): Connector => ({ active, label: active ? label : "idle", rate: 0 });

// Literal class names, so Tailwind can see them.
const GRID_COLUMNS = "xl:grid-cols-[1fr_3rem_1fr_3rem_1fr_3rem_1fr]";

/** Every stage of a flow, in reading order. */
export const flowStages = (flow: Flow): Stage[] =>
  flow.items.flatMap((item) => (item.type === "stage" ? [item.stage] : []));

// ---- What is running now ---------------------------------------------------------------------

/** Keys of the steps running now. */
function runningSteps(s: PipelineSnapshot): Set<string> {
  const jobs = s.control?.active ?? [];
  return new Set(jobs.flatMap((job) => job.steps.filter((step) => step.status === "running").map((step) => step.key)));
}

// ---- Stages -----------------------------------------------------

function replayStage(s: PipelineSnapshot, rates: Rates): Stage {
  const datasetLines = s.control?.datasetLines ?? null;
  return {
    key: "replay",
    tool: "Replayer",
    role: "1995 lines → access.log",
    icon: FileText,
    state: flowing(s.replay.state, rates.replay),
    metric: s.replay.linesWritten,
    formatMetric: formatCompact,
    metricLabel: "lines replayed",
    details: [{ label: "Rate", value: perSecond(rates.replay) }],
    progress: datasetLines
      ? { value: Math.min(100, (s.replay.linesWritten / datasetLines) * 100), label: `of ${formatCompact(datasetLines)} lines` }
      : undefined,
  };
}

function kafkaStage(s: PipelineSnapshot, rates: Rates): Stage {
  return {
    key: "kafka",
    tool: "Kafka",
    role: `${s.kafka.topic} · ${s.kafka.partitions} partitions`,
    icon: Layers,
    state: flowing(s.kafka.state, rates.kafka),
    metric: s.kafka.messages,
    formatMetric: formatCompact,
    metricLabel: "messages stored",
    details: [
      { label: "In", value: perSecond(rates.kafka) },
      { label: "Lag", value: formatInt(s.kafka.consumerLag) },
    ],
  };
}

function sparkStage(s: PipelineSnapshot, rates: Rates): Stage {
  const { spark } = s;
  const lastBatch = spark.lastBatchAt === null ? "none yet" : `${formatDuration(Math.max(0, s.takenAt - spark.lastBatchAt))} ago`;
  return {
    key: "spark",
    tool: "Spark Streaming",
    role: "→ Parquet in HDFS + MySQL",
    icon: Zap,
    state: flowing(spark.state, rates.spark),
    metric: spark.events,
    formatMetric: formatCompact,
    metricLabel: "events processed",
    details: [
      { label: "Batches", value: formatInt(spark.batches) },
      { label: "Last", value: lastBatch },
    ],
  };
}

function hiveStage(s: PipelineSnapshot): Stage {
  const runningApp = s.yarn.recent.find((app) => app.state === "RUNNING");
  return {
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
  };
}

function sqoopExportStage(s: PipelineSnapshot, exporting: boolean, importing: boolean, role: string): Stage {
  return {
    key: "sqoop",
    tool: "Sqoop",
    role,
    icon: ArrowLeftRight,
    state: s.mysql.state === "down" ? "down" : exporting || importing ? "active" : "idle",
    metric: s.mysql.resultRows,
    formatMetric: formatInt,
    metricLabel: "result rows in MySQL",
    details: [{ label: "Now", value: exporting ? "exporting" : importing ? "importing" : "waiting" }],
  };
}

function mysqlStage(s: PipelineSnapshot, exporting: boolean): Stage {
  return {
    key: "mysql",
    tool: "MySQL",
    role: `${s.mysql.database} · serving`,
    icon: Database,
    // Results only move while Sqoop exports them, so a reachable database reads as idle.
    state: s.mysql.state === "down" ? "down" : exporting ? "active" : "idle",
    metric: s.mysql.resultRows > 0 ? 6 : 0,
    formatMetric: formatInt,
    metricLabel: "result tables filled",
    details: [
      { label: "From Sqoop", value: "6 tables" },
      { label: "From Spark", value: `${formatInt(s.spark.batches)} batches` },
    ],
  };
}

function dashboardStage(s: PipelineSnapshot): Stage {
  return {
    key: "dashboard",
    tool: "Dashboard",
    role: "Next.js · localhost:3030",
    icon: Monitor,
    state: s.mysql.state === "down" ? "down" : "idle",
    metric: s.mysql.resultRows,
    formatMetric: formatInt,
    metricLabel: "result rows served",
    details: [],
  };
}

function mysqlSourceStage(s: PipelineSnapshot, importing: boolean): Stage {
  return {
    key: "mysql-source",
    tool: "MySQL",
    role: "status_codes table",
    icon: Database,
    state: s.mysql.state === "down" ? "down" : importing ? "active" : "idle",
    metric: 1,
    formatMetric: formatInt,
    metricLabel: "reference table to import",
    details: [{ label: "Database", value: s.mysql.database }],
  };
}

// ---- Three independent branches into HDFS, then the batch part --------------------------------------

/** Ordered stages and links of the pipeline, built from one snapshot. */
export function buildFlow(s: PipelineSnapshot, rates: Rates): Flow {
  const running = runningSteps(s);
  const exporting = running.has("sqoop-export");
  // The Sqoop branch runs on its own (ingest-sqoop) or with the two others (replay).
  const importing = running.has("ingest-sqoop") || running.has("sqoop-import");
  const hiveActive = s.yarn.running > 0;
  const datasetLines = s.control?.datasetLines ?? null;
  const produced = s.producer.linesWritten;
  const zoneBytes = s.hdfs.bytes + s.events.bytes + (s.speedFiles?.bytes ?? 0) + s.reference.bytes;
  const stage = (st: Stage, place: string): FlowItem => ({ type: "stage", stage: st, place });
  const link = (connector: Connector, direction: Direction, place: string): FlowItem => ({ type: "link", connector, direction, place });
  const lane = (label: string, row: string): FlowItem => ({ type: "lane", label, place: `mb-3 mt-4 xl:mt-0 xl:col-span-5 xl:col-start-1 ${row}` });

  return {
    grid: `${GRID_COLUMNS} xl:grid-rows-[auto_auto_auto_auto_auto_auto_3rem_auto_4rem_auto]`,
    items: [
      lane("Flume branch · raw lines", "xl:row-start-1 !mt-0"),
      stage(replayStage(s, rates), "xl:col-start-1 xl:row-start-2"),
      link(stream(rates.replay), "forward", "xl:col-start-2 xl:row-start-2"),
      stage(
        {
          key: "collector",
          tool: "Flume",
          role: "TAILDIR → HDFS sink",
          icon: Send,
          state: flowing(s.collector.state, rates.collector),
          metric: s.collector.eventsOut,
          formatMetric: formatCompact,
          metricLabel: "lines written to HDFS",
          details: [
            { label: "Rate", value: perSecond(rates.collector) },
            { label: "Channel", value: formatInt(s.collector.channelSize) },
          ],
        },
        "xl:col-start-3 xl:row-start-2",
      ),
      link(stream(rates.collector), "forward", "xl:col-span-3 xl:col-start-4 xl:row-start-2"),

      lane("Sqoop branch · reference data", "xl:row-start-3 xl:pt-6"),
      stage(mysqlSourceStage(s, importing), "xl:col-start-1 xl:row-start-4"),
      link(signal(importing, "status_codes"), "forward", "xl:col-start-2 xl:row-start-4"),
      stage(
        {
          key: "import",
          tool: "Sqoop import",
          role: "MySQL status_codes → HDFS",
          icon: DatabaseZap,
          state: s.reference.state === "down" ? "down" : importing ? "active" : "idle",
          metric: s.reference.files,
          formatMetric: formatInt,
          metricLabel: "reference files",
          details: [
            { label: "Size", value: formatBytes(s.reference.bytes) },
            { label: "Now", value: importing ? "importing" : "waiting" },
          ],
        },
        "xl:col-start-3 xl:row-start-4",
      ),
      link(signal(importing, "to HDFS"), "forward", "xl:col-span-3 xl:col-start-4 xl:row-start-4"),

      lane("Kafka branch · JSON events, two consumers", "xl:row-start-5 xl:pt-6"),
      stage(
        {
          key: "producer",
          tool: "Kafka producer",
          role: "NASA files → JSON events",
          icon: FileText,
          state: flowing(s.producer.state, rates.producer),
          metric: produced,
          formatMetric: formatCompact,
          metricLabel: "events acknowledged",
          details: [{ label: "Rate", value: perSecond(rates.producer) }],
          progress: datasetLines
            ? { value: Math.min(100, (produced / datasetLines) * 100), label: `of ${formatCompact(datasetLines)} events` }
            : undefined,
        },
        "xl:col-start-1 xl:row-start-6",
      ),
      link(stream(rates.producer), "forward", "xl:col-start-2 xl:row-start-6"),
      stage(kafkaStage(s, rates), "xl:col-start-3 xl:row-start-6"),
      link(stream(rates.writer), "forward", "xl:col-start-4 xl:row-start-6"),
      stage(
        {
          key: "writer",
          tool: "Archive writer",
          role: "kafka-hdfs-writer → JSON in HDFS",
          icon: Workflow,
          state: flowing(s.writer.state, rates.writer),
          metric: s.writer.eventsOut,
          formatMetric: formatCompact,
          metricLabel: "events written",
          details: [
            { label: "Rate", value: perSecond(rates.writer) },
            { label: "Files", value: formatInt(s.events.files) },
          ],
        },
        "xl:col-start-5 xl:row-start-6",
      ),
      link(stream(rates.writer), "forward", "xl:col-start-6 xl:row-start-6"),

      // Second consumer: Spark sits under Kafka, writes Parquet to HDFS and drops live totals into MySQL.
      link(stream(rates.spark), "down", "xl:col-start-3 xl:row-start-7"),
      stage(sparkStage(s, rates), "xl:col-start-3 xl:row-start-8"),
      link(stream(rates.spark), "forward", "xl:col-span-3 xl:col-start-4 xl:row-start-8"),

      stage(
        {
          key: "hdfs",
          tool: "HDFS",
          role: "/data/nasa/…",
          icon: HardDrive,
          state: flowing(s.hdfs.state, rates.collector + rates.writer),
          metric: s.hdfs.partitions,
          formatMetric: formatInt,
          metricLabel: "days of raw lines",
          details: [
            { label: "Events", value: formatInt(s.events.files) + " files" },
            { label: "Size", value: formatBytes(zoneBytes) },
            { label: "Speed", value: formatInt(s.speedFiles?.files ?? 0) + " files" },
            { label: "Open", value: formatInt(s.hdfs.openFiles + s.events.openFiles) },
          ],
        },
        "xl:col-start-7 xl:row-span-7 xl:row-start-2",
      ),

      { type: "lane", label: "Batch analysis and reporting", place: "mt-6 mb-1 xl:col-span-2 xl:col-start-1 xl:row-start-9 xl:mt-0 xl:self-end" },
      link(signal(hiveActive && !exporting, "reading"), "down", "xl:col-start-7 xl:row-start-9"),
      stage(hiveStage(s), "xl:col-start-7 xl:row-start-10"),
      link(signal(exporting, "results"), "backward", "xl:col-start-6 xl:row-start-10"),
      stage(sqoopExportStage(s, exporting, false, "HDFS → MySQL"), "xl:col-start-5 xl:row-start-10"),
      link(signal(exporting, "export"), "backward", "xl:col-start-4 xl:row-start-10"),
      link(stream(rates.spark), "down", "hidden xl:block xl:col-start-3 xl:row-start-9"),
      stage(mysqlStage(s, exporting), "xl:col-start-3 xl:row-start-10"),
      link(signal(s.mysql.state !== "down", "queries"), "backward", "xl:col-start-2 xl:row-start-10"),
      stage(dashboardStage(s), "xl:col-start-1 xl:row-start-10"),
    ],
  };
}
