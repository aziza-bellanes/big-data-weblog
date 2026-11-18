// Shapes shared by the server data layer and the client components.

export interface TopPage {
  path: string;
  hits: number;
}

export interface HourlyHits {
  hourOfDay: number;
  hits: number;
  avgHitsPerDay: number;
}

export interface DailyHits {
  day: string; // YYYY-MM-DD
  hits: number;
  clientErrors: number;
  serverErrors: number;
  uniqueHosts: number;
}

export interface StatusShare {
  status: number;
  label: string | null;
  category: string | null;
  hits: number;
  pct: number;
}

export interface TopHost {
  host: string;
  hits: number;
}

export interface DataQuality {
  totalLines: number;
  parsedLines: number;
  malformedLines: number;
  malformedPct: number;
}

export interface Results {
  topPages: TopPage[];
  hourly: HourlyHits[];
  daily: DailyHits[];
  statuses: StatusShare[];
  topHosts: TopHost[];
  quality: DataQuality | null;
}

// ---- Architectures (config/architectures.json) ----

/** A · Sequential (Flume → Kafka → Flume) or B · Parallel (Flume, Kafka and Sqoop side by side). */
export type ArchName = "parallel" | "sequential";

export interface Architecture {
  name: ArchName;
  label: string;
  summary: string;
  liveDir: string;
  rawDir: string;
  eventsDir: string | null;
  referenceDir: string;
  resultsRoot: string;
  hiveDb: string;
  mysqlDb: string;
  kafkaTopic: string;
  consumerGroup: string;
}

/** What the browser needs to show the architecture switch. */
export interface ArchitectureChoice {
  name: ArchName;
  label: string;
  summary: string;
}

// ---- Live pipeline ----

/** Health of one pipeline stage, as shown by the status dots. */
export type StageState = "active" | "idle" | "down";

export interface ReplayStatus {
  state: StageState;
  linesWritten: number;
}

export interface FlumeAgentStatus {
  state: StageState;
  eventsIn: number;
  eventsOut: number;
  channelSize: number;
  channelFillPct: number;
}

export interface KafkaStatus {
  state: StageState;
  topic: string;
  partitions: number;
  messages: number;
  consumerLag: number;
}

export interface HdfsStatus {
  state: StageState;
  /** Folder the figures describe. */
  path: string;
  partitions: number;
  files: number;
  bytes: number;
  openFiles: number;
}

export interface YarnJob {
  id: string;
  name: string;
  state: string;
  progress: number;
  elapsedMs: number;
}

export interface YarnStatus {
  state: StageState;
  running: number;
  completed: number;
  failed: number;
  recent: YarnJob[];
}

export interface MysqlStatus {
  state: StageState;
  database: string;
  resultRows: number;
}

// ---- Control API (runs pipeline steps in the client container) ----

export type JobAction =
  | "replay" | "pipeline" | "counts" | "reset" | "compare"
  | "hive-tables" | "sqoop-import" | "hive-analysis" | "sqoop-export"
  | "ingest-flume" | "ingest-kafka" | "ingest-sqoop" | "verify-ingestion";
export type StepStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled" | "skipped";
export type JobStatus = "running" | "succeeded" | "failed" | "cancelled";

export interface JobStep {
  key: string;
  label: string;
  arch: ArchName | null;
  status: StepStatus;
  startedAt: number | null;
  endedAt: number | null;
  exitCode: number | null;
}

/** Latest sample of an ingestion in progress (scripts/runs.py). */
export interface IngestionPoint {
  arch: ArchName;
  phase: "replay" | "settle";
  /** Seconds since the ingestion started. */
  t: number;
  replayed: number;
  inHdfs: number;
  lag: number | null;
  produced?: number;
  eventsInHdfs?: number;
}

export interface Job {
  id: string;
  action: JobAction;
  /** Null for a comparison, which runs both. */
  arch: ArchName | null;
  params: { rate?: number; limit?: number; fresh?: boolean };
  status: JobStatus;
  createdAt: number;
  endedAt: number | null;
  steps: JobStep[];
  progress: IngestionPoint | null;
  lastSeq: number;
}

export interface ControlStatus {
  /** First running job; `active` lists every running job (A and B can run at once). */
  current: Job | null;
  active: Job[];
  history: Job[];
  /** Lines in the downloaded dataset, null while still being counted. */
  datasetLines: number | null;
  defaultArch: ArchName;
  /** A replay started outside the dashboard (make replay) is writing to that architecture. */
  replayRunning: Record<ArchName, boolean>;
}

export interface LogLine {
  seq: number;
  text: string;
}

export interface PipelineSnapshot {
  takenAt: number;
  arch: ArchName;
  /** Null when the control API (client container) is unreachable. */
  control: ControlStatus | null;
  /** Lines written to the live log. */
  replay: ReplayStatus;
  /** The Flume agent tailing the live log: A flume-agent1 (to Kafka), B flume-direct (to HDFS). */
  collector: FlumeAgentStatus;
  kafka: KafkaStatus;
  /** What writes Kafka's messages to HDFS: A flume-agent2, B the Kafka HDFS writer. */
  writer: FlumeAgentStatus;
  /** B only: events the producer published to Kafka and saw acknowledged. */
  producer: ReplayStatus | null;
  /** Raw log lines in HDFS, one folder per day. */
  hdfs: HdfsStatus;
  /** B only: JSON events in HDFS. */
  events: HdfsStatus | null;
  /** B only: the status_codes copy imported by its Sqoop branch. */
  reference: HdfsStatus | null;
  yarn: YarnStatus;
  mysql: MysqlStatus;
}

// ---- Run and comparison records (control API /runs) ----

export interface IngestionSummary {
  lines: number;
  replaySeconds: number | null;
  allWrittenSeconds: number | null;
  allClosedSeconds: number | null;
  linesPerSecond: number | null;
  peakKafkaLag: number;
  raw: { files: number; bytes: number; avgFileBytes: number } | null;
  events?: { files: number; bytes: number; avgFileBytes: number } | null;
  eventsProduced?: number;
  samples?: Omit<IngestionPoint, "arch" | "phase">[];
}

export interface ArchRun {
  ingestion?: IngestionSummary;
  steps: Record<string, number>;
  batchSeconds: number | null;
  results?: Record<string, { rows: number; sha256: string }>;
}

export interface RunRecord {
  id: string;
  kind: "run" | "comparison";
  action: JobAction;
  arch: ArchName | null;
  params: Job["params"];
  status: JobStatus;
  createdAt: number;
  endedAt: number | null;
  architectures: Partial<Record<ArchName, ArchRun>>;
  comparison?: { resultsMatch: Record<string, boolean>; allResultsMatch: boolean };
}
