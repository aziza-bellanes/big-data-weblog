import "server-only";
import { config } from "@/lib/config";
import { fetchControlStatus } from "@/lib/sources/control";
import { fetchFlumeAgent } from "@/lib/sources/flume";
import { fetchHdfsStatus } from "@/lib/sources/hdfs";
import { orFallback } from "@/lib/sources/http";
import { fetchKafkaStatus } from "@/lib/sources/kafka";
import { fetchMysqlStatus } from "@/lib/sources/mysql";
import { fetchReplayStatus } from "@/lib/sources/replay";
import { fetchYarnStatus } from "@/lib/sources/yarn";
import type { PipelineSnapshot } from "@/lib/types";

// What a stage reports when its system cannot be reached.
const downAgent = { state: "down", eventsIn: 0, eventsOut: 0, channelSize: 0, channelFillPct: 0 } as const;

/** Probe every stage in parallel. A stage that does not answer is reported as "down". */
export async function takeSnapshot(): Promise<PipelineSnapshot> {
  const [control, replay, agent1, kafka, agent2, hdfs, yarn, mysql] = await Promise.all([
    orFallback("control", fetchControlStatus, null),
    fetchReplayStatus(),
    orFallback("flume-agent1", () => fetchFlumeAgent(config.flume.agent1Url), downAgent),
    orFallback("kafka", fetchKafkaStatus, {
      state: "down", topic: config.kafka.topic, partitions: 0, messages: 0, consumerLag: 0,
    } as const),
    orFallback("flume-agent2", () => fetchFlumeAgent(config.flume.agent2Url), downAgent),
    orFallback("hdfs", fetchHdfsStatus, { state: "down", partitions: 0, files: 0, bytes: 0, openFiles: 0 } as const),
    orFallback("yarn", fetchYarnStatus, { state: "down", running: 0, completed: 0, failed: 0, recent: [] }),
    orFallback("mysql", fetchMysqlStatus, { state: "down", resultRows: 0 } as const),
  ]);
  return { takenAt: Date.now(), control, replay, agent1, kafka, agent2, hdfs, yarn, mysql };
}
