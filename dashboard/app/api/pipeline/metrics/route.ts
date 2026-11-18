import { takeSnapshot } from "@/lib/pipeline";
import { connection } from "next/server";

export async function GET() {
  await connection();
  const s = await takeSnapshot();
  const imports = s.control ? [...s.control.active, ...s.control.history].filter(j => ["ingest-sqoop", "sqoop-import"].includes(j.action)) : [];
  const importState = !s.control ? "unknown" : imports[0]?.status === "running" ? "running" : imports[0]?.status === "failed" ? "failed" : imports[0]?.status === "succeeded" ? "completed" : "idle";
  return Response.json({observed_at: s.takenAt, canonical_source: "flume", branches: {
    flume: {state: s.agent1.state === "down" ? "unknown" : s.agent1.state,
      source: "Flume HTTP counters", accepted: s.agent1.state === "down" ? null : s.agent1.eventsIn,
      sent: s.agent1.state === "down" ? null : s.agent1.eventsOut,
      channel_depth: s.agent1.state === "down" ? null : s.agent1.channelSize, destination: "/data/nasa/raw/flume"},
    kafka: {state: s.kafka.state === "down" || s.agent2.state === "down" ? "unknown" : s.kafka.consumerLag > 0 ? "backlogged" : "running",
      source: "Kafka broker offsets and HDFS writer HTTP counters", topic_events: s.kafka.state === "down" ? null : s.kafka.messages,
      lag: s.kafka.state === "down" ? null : s.kafka.consumerLag,
      persisted_this_session: s.agent2.state === "down" ? null : s.agent2.eventsOut,
      destination: "/data/nasa/streaming/kafka"},
    sqoop: {state: importState, source: "control API job history",
      jobs: s.control ? [...s.control.active, ...s.control.history].filter(j => ["ingest-sqoop", "sqoop-import", "ingest-parallel"].includes(j.action)) : null,
      destination: "/data/nasa/reference/sqoop/status_codes"},
  }});
}
