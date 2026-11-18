import "server-only";
import { getArchitecture } from "@/lib/architectures";
import { config } from "@/lib/config";
import { fetchControlStatus } from "@/lib/sources/control";
import { fetchFlumeAgent } from "@/lib/sources/flume";
import { fetchHdfsStatus } from "@/lib/sources/hdfs";
import { orFallback } from "@/lib/sources/http";
import { fetchKafkaStatus } from "@/lib/sources/kafka";
import { fetchMysqlStatus } from "@/lib/sources/mysql";
import { fetchCheckpoint } from "@/lib/sources/replay";
import { fetchYarnStatus } from "@/lib/sources/yarn";
import type { ArchName, HdfsStatus, PipelineSnapshot } from "@/lib/types";

// What a stage reports when its system cannot be reached.
const downAgent = { state: "down", eventsIn: 0, eventsOut: 0, channelSize: 0, channelFillPct: 0 } as const;
const downHdfs = (path: string): HdfsStatus => ({ state: "down", path, partitions: 0, files: 0, bytes: 0, openFiles: 0 });

/** Probe every stage of one architecture in parallel. A stage that does not answer is "down". */
export async function takeSnapshot(arch: ArchName): Promise<PipelineSnapshot> {
  const a = getArchitecture(arch);
  const services = config.services[arch];
  const [control, replay, collector, kafka, writer, producer, hdfs, events, reference, yarn, mysql] = await Promise.all([
    orFallback("control", fetchControlStatus, null),
    fetchCheckpoint(`${a.liveDir}/access.log.offset`),
    orFallback("collector", () => fetchFlumeAgent(services.collector), downAgent),
    orFallback("kafka", () => fetchKafkaStatus(a.kafkaTopic, a.consumerGroup), {
      state: "down", topic: a.kafkaTopic, partitions: 0, messages: 0, consumerLag: 0,
    } as const),
    orFallback("writer", () => fetchFlumeAgent(services.writer), downAgent),
    a.eventsDir ? fetchCheckpoint(`${a.liveDir}/producer.offset`) : null,
    orFallback("hdfs", () => fetchHdfsStatus(a.rawDir), downHdfs(a.rawDir)),
    a.eventsDir ? orFallback("hdfs-events", () => fetchHdfsStatus(a.eventsDir!), downHdfs(a.eventsDir)) : null,
    a.eventsDir ? orFallback("hdfs-reference", () => fetchHdfsStatus(a.referenceDir), downHdfs(a.referenceDir)) : null,
    orFallback("yarn", fetchYarnStatus, { state: "down", running: 0, completed: 0, failed: 0, recent: [] }),
    orFallback("mysql", () => fetchMysqlStatus(a.mysqlDb), { state: "down", database: a.mysqlDb, resultRows: 0 } as const),
  ]);
  return {
    takenAt: Date.now(), arch, control, replay, collector, kafka, writer, producer, hdfs, events, reference, yarn, mysql,
  };
}
