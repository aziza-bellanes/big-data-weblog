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

/** The one architecture: Flume, Kafka (archive writer and speed layer) and Sqoop side by side. */
export type ArchName = "parallel";

export interface Architecture {
  name: ArchName;
  label: string;
  summary: string;
  liveDir: string;
  rawDir: string;
  eventsDir: string;
  speedDir: string | null;
  speedCheckpoint: string | null;
  referenceDir: string;
  resultsRoot: string;
  hiveDb: string;
  mysqlDb: string;
  kafkaTopic: string;
  consumerGroup: string;
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
  | "replay" | "pipeline" | "counts" | "reset"
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
  arch: ArchName | null;
  params: { rate?: number; limit?: number };
  status: JobStatus;
  createdAt: number;
  endedAt: number | null;
  steps: JobStep[];
  progress: IngestionPoint | null;
  lastSeq: number;
}

export interface ControlStatus {
  /** Write and scheduling readiness; separate from the control service's liveness. */
  readiness?: { ready: boolean; problems: string[] };
  /** First running job; `active` lists every running job. */
  current: Job | null;
  active: Job[];
  history: Job[];
  /** Lines in the downloaded dataset, null while still being counted. */
  datasetLines: number | null;
  defaultArch: ArchName;
  /** A replay started outside the dashboard (make replay) is writing. */
  replayRunning: Record<ArchName, boolean>;
}

export interface LogLine {
  seq: number;
  text: string;
}

export interface PipelineSnapshot {
  takenAt: number;
  /** Null when the control API (client container) is unreachable. */
  control: ControlStatus | null;
  /** Lines written to the live log. */
  replay: ReplayStatus;
  /** The Flume agent tailing the live log (flume-direct, to HDFS). */
  collector: FlumeAgentStatus;
  kafka: KafkaStatus;
  /** The Kafka consumer archiving the JSON events to HDFS (kafka-hdfs-writer). */
  writer: FlumeAgentStatus;
  /** Events the producer published to Kafka and saw acknowledged. */
  producer: ReplayStatus;
  /** Raw log lines in HDFS, one folder per day. */
  hdfs: HdfsStatus;
  /** JSON events in HDFS. */
  events: HdfsStatus;
  /** Parquet files written by the Spark speed layer. */
  speedFiles: HdfsStatus | null;
  /** The Spark speed layer, from its serving tables in MySQL. */
  spark: SparkStatus;
  /** The status_codes copy imported by the Sqoop branch. */
  reference: HdfsStatus;
  yarn: YarnStatus;
  mysql: MysqlStatus;
}

// ---- Speed layer (Spark Structured Streaming, serving tables in MySQL) ----

export interface SparkStatus {
  state: StageState;
  batches: number;
  events: number;
  /** Epoch ms of the last micro-batch, null before the first. */
  lastBatchAt: number | null;
  /** Event-time minute reached ("1995-07-13 10:42"). */
  lastMinute: string | null;
}

export interface SpeedMinute {
  minute: string;
  hits: number;
  clientErrors: number;
  serverErrors: number;
}

export type AlertKind = "traffic_spike" | "not_found_burst" | "server_errors" | "host_flood";

export interface SpeedAlert {
  minute: string;
  kind: AlertKind;
  subject: string;
  value: number;
  threshold: number;
}

/** One day, seen by the speed layer and by the batch layer (null when Hive has not run). */
export interface SpeedDay {
  day: string;
  speed: { hits: number; clientErrors: number; serverErrors: number };
  batch: { hits: number; clientErrors: number; serverErrors: number } | null;
  match: boolean | null;
}

export interface SpeedSnapshot {
  takenAt: number;
  status: SparkStatus;
  alertCount: number;
  /** Latest minutes of event time, oldest first. */
  minutes: SpeedMinute[];
  alerts: SpeedAlert[];
  days: SpeedDay[];
  /** False until the batch layer has exported hits_per_day. */
  batchRun: boolean;
}

/** Flagged minutes of one alert kind, with the worst one. */
export interface AlertSummary {
  kind: AlertKind;
  flagged: number;
  threshold: number;
  worstValue: number;
  worstMinute: string;
  /** Host of the worst minute for host_flood, '' otherwise. */
  worstSubject: string;
}

export interface FloodHost {
  host: string;
  flaggedMinutes: number;
  maxRequests: number;
}

/** What the Analytics page shows of the speed layer. */
export interface SpeedAnalytics {
  alerts: AlertSummary[];
  floodHosts: FloodHost[];
  days: SpeedDay[];
  batchRun: boolean;
}
