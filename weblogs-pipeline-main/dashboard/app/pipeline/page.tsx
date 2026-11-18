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
        description="Run the selected architecture from here and follow every line into HDFS, through the Hive analysis and the Sqoop export. The switch in the top bar changes architecture."
        aside={<LiveIndicator />}
      />
      <PageBody>
        <PipelineBoard />
      </PageBody>
    </>
  );
}
