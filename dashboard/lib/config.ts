import "server-only";

// Connection settings for every system the dashboard reads. Defaults match docker-compose.yml;
// each value can be overridden through the environment.
const env = (name: string, fallback: string) => process.env[name] ?? fallback;

export const config = {
  mysql: {
    host: env("MYSQL_HOST", "mysql"),
    port: Number(env("MYSQL_PORT", "3306")),
    database: env("MYSQL_DATABASE", "weblogs"),
    user: env("MYSQL_USER", "sqoop"),
    password: env("MYSQL_PASSWORD", "sqoop"),
  },
  kafka: {
    brokers: env("KAFKA_BOOTSTRAP_SERVERS", "kafka:9092").split(","),
    topic: env("KAFKA_TOPIC", "web-logs"),
    consumerGroup: env("KAFKA_CONSUMER_GROUP", "kafka-hdfs-writer"),
  },
  hdfs: {
    url: env("HDFS_HTTP_URL", "http://hadoop:9870"),
    weblogsPath: "/data/nasa/raw/flume",
  },
  yarnUrl: env("YARN_HTTP_URL", "http://hadoop:8088"),
  flume: {
    agent1Url: env("FLUME_AGENT1_METRICS_URL", "http://flume-agent1:34545/metrics"),
    agent2Url: env("FLUME_AGENT2_METRICS_URL", "http://kafka-hdfs-writer:34545/metrics"),
  },
  controlUrl: env("CONTROL_URL", "http://client:8000"),
  replayOffsetFile: env("REPLAY_OFFSET_FILE", "/data/live/access.log.offset"),
  // Upper bound for any single call to a backing system, so one slow service cannot stall a page.
  requestTimeoutMs: 2500,
} as const;
