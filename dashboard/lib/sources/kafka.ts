import "server-only";
import { Kafka, logLevel, type Admin } from "kafkajs";
import { config } from "@/lib/config";
import type { KafkaStatus } from "@/lib/types";

let admin: Promise<Admin> | undefined;

/** One long-lived admin connection, re-created after a failure. */
function getAdmin(): Promise<Admin> {
  admin ??= (async () => {
    const client = new Kafka({
      clientId: "weblogs-dashboard",
      brokers: [...config.kafka.brokers],
      connectionTimeout: config.requestTimeoutMs,
      requestTimeout: config.requestTimeoutMs,
      retry: { retries: 0 },
      logLevel: logLevel.NOTHING,
    }).admin();
    await client.connect();
    return client;
  })().catch((error: unknown) => {
    admin = undefined;
    throw error;
  });
  return admin;
}

/** Messages in a topic and how far its HDFS writer (consumer group) is behind them. */
export async function fetchKafkaStatus(topic: string, consumerGroup: string): Promise<KafkaStatus> {
  try {
    const client = await getAdmin();
    // One after the other on purpose: concurrent admin calls on a fresh connection race on the
    // metadata refresh and fail with "No brokers in the broker pool".
    const ends = await client.fetchTopicOffsets(topic);
    const committed = await client.fetchOffsets({ groupId: consumerGroup, topics: [topic] });
    const consumed = new Map(
      (committed[0]?.partitions ?? []).map((p) => [p.partition, Math.max(0, Number(p.offset))]),
    );
    let messages = 0;
    let consumerLag = 0;
    for (const { partition, high, low } of ends) {
      messages += Number(high) - Number(low);
      consumerLag += Number(high) - (consumed.get(partition) ?? Number(low));
    }
    return {
      state: consumerLag > 0 ? "active" : "idle",
      topic,
      partitions: ends.length,
      messages,
      consumerLag,
    };
  } catch (error) {
    const stale = admin;
    admin = undefined;
    void stale?.then((c) => c.disconnect()).catch(() => undefined);
    throw error;
  }
}
