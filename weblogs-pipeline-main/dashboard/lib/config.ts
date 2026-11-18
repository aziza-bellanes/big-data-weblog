import "server-only";
import type { ArchName } from "@/lib/types";

// Connection settings for every system the dashboard reads. Defaults match docker-compose.yml;
// each value can be overridden through the environment. Folders, topics and databases of each
// architecture come from config/architectures.json (lib/architectures.ts).
const env = (name: string, fallback: string) => process.env[name] ?? fallback;
const metrics = (service: string) => `http://${service}:34545/metrics`;

export const config = {
  mysql: {
    host: env("MYSQL_HOST", "mysql"),
    port: Number(env("MYSQL_PORT", "3306")),
    user: env("MYSQL_USER", "sqoop"),
    password: env("MYSQL_PASSWORD", "sqoop"),
  },
  kafka: {
    brokers: env("KAFKA_BOOTSTRAP_SERVERS", "kafka:9092").split(","),
  },
  hdfsUrl: env("HDFS_HTTP_URL", "http://hadoop:9870"),
  yarnUrl: env("YARN_HTTP_URL", "http://hadoop:8088"),
  controlUrl: env("CONTROL_URL", "http://client:8000"),
  /** HTTP metrics of the service tailing the live log (collector) and of the one writing
   *  Kafka's messages to HDFS (writer), per architecture. */
  services: {
    sequential: { collector: metrics("flume-agent1"), writer: metrics("flume-agent2") },
    parallel: { collector: metrics("flume-direct"), writer: metrics("kafka-hdfs-writer") },
  } satisfies Record<ArchName, { collector: string; writer: string }>,
  // Upper bound for any single call to a backing system, so one slow service cannot stall a page.
  requestTimeoutMs: 2500,
} as const;
