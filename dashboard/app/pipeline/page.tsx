import type { Metadata } from "next";
import { PageBody, PageHeader } from "@/components/page-header";
import { LiveIndicator } from "@/components/pipeline/live-indicator";
import { PipelineBoard } from "@/components/pipeline/pipeline-board";

export const metadata: Metadata = { title: "Live pipeline" };

export default function PipelinePage() {
  return (
    <>
      <PageHeader
        number="04"
        eyebrow="Live pipeline"
        title="Data in motion"
        description="Run the pipeline from here and follow every line into HDFS, through the Spark speed layer, the Hive analysis and the Sqoop export."
        aside={<LiveIndicator />}
      />
      <PageBody>
        <PipelineBoard />
      </PageBody>
    </>
  );
}
