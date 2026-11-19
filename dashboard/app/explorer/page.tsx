import type { Metadata } from "next";
import { ExplorerBrowser } from "@/components/explorer/explorer-browser";
import { PageBody, PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Data explorer" };

export default function ExplorerPage() {
  return (
    <>
      <PageHeader
        number="05"
        eyebrow="Data explorer"
        title="Inside HDFS"
        description="A read-only view of the HDFS folders of the pipeline. Folders show their first 200 entries and files their first 50 lines."
      />
      <PageBody>
        <ExplorerBrowser />
      </PageBody>
    </>
  );
}
