import type { Metadata } from "next";
import { PageBody, PageHeader } from "@/components/page-header";
import { SpeedBoard } from "@/components/realtime/speed-board";

export const metadata: Metadata = { title: "Real-time" };

export default function RealtimePage() {
  return (
    <>
      <PageHeader
        number="03"
        eyebrow="Real-time"
        title="The speed layer"
        description="Kafka feeds Spark Structured Streaming, which computes per-minute traffic and alerts every 5 seconds and writes them to HDFS (Parquet) and MySQL: seconds behind the replay. The batch path (Flume, HDFS, Hive) gives the exact results later; both layers must agree once all the lines have been processed."
      />
      <PageBody>
        <SpeedBoard />
      </PageBody>
    </>
  );
}
