import "server-only";
import { getArchitecture } from "@/lib/architectures";
import { config } from "@/lib/config";
import { fetchControlStatus } from "@/lib/sources/control";
import { fetchFlumeAgent } from "@/lib/sources/flume";
import { fetchHdfsStatus } from "@/lib/sources/hdfs";
import { orFallback } from "@/lib/sources/http";
import { fetchKafkaStatus } from "@/lib/sources/kafka";
import { fetchMysqlStatus, fetchSparkStatus } from "@/lib/sources/mysql";
import { fetchCheckpoint } from "@/lib/sources/replay";
import { fetchYarnStatus } from "@/lib/sources/yarn";
import type { HdfsStatus, PipelineSnapshot, SparkStatus } from "@/lib/types";

// What a stage reports when its system cannot be reached.
const downAgent = { state: "down", eventsIn: 0, eventsOut: 0, channelSize: 0, channelFillPct: 0 } as const;
const downSpark: SparkStatus = { state: "down", batches: 0, events: 0, lastBatchAt: null, lastMinute: null };
const downHdfs = (path: string): HdfsStatus => ({ state: "down", path, partitions: 0, files: 0, bytes: 0, openFiles: 0 });

/** Probe every stage of the pipeline in parallel. A stage that does not answer is "down". */
export async function takeSnapshot(): Promise<PipelineSnapshot> {
  const a = getArchitecture();
  const services = config.services;
  const [control, replay, collector, kafka, writer, producer, hdfs, events, speedFiles, reference, yarn, mysql, spark] = await Promise.all([
    orFallback("control", fetchControlStatus, null),
    fetchCheckpoint(`${a.liveDir}/access.log.offset`),
    orFallback("collector", () => fetchFlumeAgent(services.collector), downAgent),
    orFallback("kafka", () => fetchKafkaStatus(a.kafkaTopic, a.consumerGroup), {
      state: "down", topic: a.kafkaTopic, partitions: 0, messages: 0, consumerLag: 0,
    } as const),
    orFallback("writer", () => fetchFlumeAgent(services.writer), downAgent),
    fetchCheckpoint(`${a.liveDir}/producer.offset`),
    orFallback("hdfs", () => fetchHdfsStatus(a.rawDir), downHdfs(a.rawDir)),
    orFallback("hdfs-events", () => fetchHdfsStatus(a.eventsDir), downHdfs(a.eventsDir)),
    a.speedDir ? orFallback("hdfs-speed", () => fetchHdfsStatus(a.speedDir!), downHdfs(a.speedDir)) : null,
    orFallback("hdfs-reference", () => fetchHdfsStatus(a.referenceDir), downHdfs(a.referenceDir)),
    orFallback("yarn", fetchYarnStatus, { state: "down", running: 0, completed: 0, failed: 0, recent: [] }),
    orFallback("mysql", () => fetchMysqlStatus(a.mysqlDb), { state: "down", database: a.mysqlDb, resultRows: 0 } as const),
    orFallback("spark", () => fetchSparkStatus(a.mysqlDb), downSpark),
  ]);
  return {
    takenAt: Date.now(), control, replay, collector, kafka, writer, producer, hdfs, events, speedFiles, spark, reference, yarn, mysql,
  };
}
