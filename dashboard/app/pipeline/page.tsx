import type { Metadata } from "next";
import { PageBody, PageHeader } from "@/components/page-header";
import { LiveIndicator } from "@/components/pipeline/live-indicator";
import { PipelineBoard } from "@/components/pipeline/pipeline-board";

export const metadata: Metadata = { title: "Live pipeline" };

export default function PipelinePage() {
  return (
    <>
      <PageHeader
        number="03"
        eyebrow="Live pipeline"
        title="Data in motion"
        description="Run the pipeline from here and follow every line: replayed independently through Flume and Kafka, joined with Sqoop reference imports in HDFS, analysed by Hive and exported by Sqoop."
        aside={<LiveIndicator />}
      />
      <PageBody>
        <PipelineBoard />
      </PageBody>
    </>
  );
}
