import { connection } from "next/server";
import { getArchitecture } from "@/lib/architectures";
import { takeSnapshot } from "@/lib/pipeline";
import type { FlumeAgentStatus, Job } from "@/lib/types";

const SQOOP_ACTIONS = new Set(["ingest-sqoop", "sqoop-import", "replay"]);
const known = <T,>(agent: FlumeAgentStatus, value: T): T | null => (agent.state === "down" ? null : value);

/**
 * Architecture B, branch by branch, for scripts and monitoring: what each ingestion branch has
 * done and where its data lands. Unknown values are null, never zero.
 */
export async function GET() {
  await connection();
  const s = await takeSnapshot("parallel");
  const a = getArchitecture("parallel");
  const jobs: Job[] = s.control ? [...s.control.active, ...s.control.history] : [];
  const sqoopJobs = jobs.filter((job) => job.arch === "parallel" && SQOOP_ACTIONS.has(job.action));
  const lastSqoop = sqoopJobs[0]?.status;
  return Response.json({
    observed_at: s.takenAt,
    architecture: a.name,
    branches: {
      flume: {
        state: s.collector.state === "down" ? "unknown" : s.collector.state,
        source: "Flume HTTP counters",
        accepted: known(s.collector, s.collector.eventsIn),
        written: known(s.collector, s.collector.eventsOut),
        channel_depth: known(s.collector, s.collector.channelSize),
        destination: a.rawDir,
      },
      kafka: {
        state: s.kafka.state === "down" || s.writer.state === "down" ? "unknown" : s.kafka.consumerLag > 0 ? "backlogged" : "idle",
        source: "producer checkpoint, Kafka offsets and HDFS writer counters",
        topic: a.kafkaTopic,
        acknowledged_events: s.producer?.linesWritten ?? null,
        topic_events: s.kafka.state === "down" ? null : s.kafka.messages,
        lag: s.kafka.state === "down" ? null : s.kafka.consumerLag,
        written_since_writer_start: known(s.writer, s.writer.eventsOut),
        destination: a.eventsDir,
      },
      sqoop: {
        state: !s.control ? "unknown" : lastSqoop === "running" ? "running" : lastSqoop ?? "idle",
        source: "control API job history",
        jobs: s.control ? sqoopJobs : null,
        destination: a.referenceDir,
      },
    },
  });
}
