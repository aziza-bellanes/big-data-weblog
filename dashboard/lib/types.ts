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
  resultRows: number;
}

// ---- Control API (runs pipeline steps in the client container) ----

export type JobAction = "ingest-flume" | "ingest-kafka" | "ingest-sqoop" | "ingest-parallel" | "verify-ingestion" | "replay" | "pipeline" | "counts" | "hive-tables" | "sqoop-import" | "hive-analysis" | "sqoop-export";
export type StepStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled" | "skipped";
export type JobStatus = "running" | "succeeded" | "failed" | "cancelled";

export interface JobStep {
  key: string;
  label: string;
  status: StepStatus;
  startedAt: number | null;
  endedAt: number | null;
  exitCode: number | null;
}

export interface Job {
  id: string;
  action: JobAction;
  status: JobStatus;
  createdAt: number;
  endedAt: number | null;
  steps: JobStep[];
  lastSeq: number;
}

export interface ControlStatus {
  current: Job | null;
  active: Job[];
  history: Job[];
  /** Lines in the downloaded dataset, null while still being counted. */
  datasetLines: number | null;
  replayRunning: boolean;
}

export interface LogLine {
  seq: number;
  text: string;
}

export interface PipelineSnapshot {
  takenAt: number;
  /** Null when the control API (client container) is unreachable. */
  control: ControlStatus | null;
  replay: ReplayStatus;
  agent1: FlumeAgentStatus;
  kafka: KafkaStatus;
  agent2: FlumeAgentStatus;
  hdfs: HdfsStatus;
  yarn: YarnStatus;
  mysql: MysqlStatus;
}
