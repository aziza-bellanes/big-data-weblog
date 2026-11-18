import type { Metadata } from "next";
import { CompareBoard } from "@/components/compare/compare-board";
import { PageBody, PageHeader } from "@/components/page-header";
import { LiveIndicator } from "@/components/pipeline/live-indicator";

export const metadata: Metadata = { title: "Compare" };

export default function ComparePage() {
  return (
    <>
      <PageHeader
        number="04"
        eyebrow="Compare"
        title="A against B"
        description="Run both architectures on the same lines at the same rate and compare how fast every line reaches HDFS, how the files are laid out, how long the batch part takes, and whether the results are identical."
        aside={<LiveIndicator />}
      />
      <PageBody>
        <CompareBoard />
      </PageBody>
    </>
  );
}
