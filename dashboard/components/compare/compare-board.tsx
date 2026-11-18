"use client";

import { GitCompareArrows } from "lucide-react";
import { SectionTitle } from "@/components/page-header";
import { usePipelineContext } from "@/components/pipeline/pipeline-context";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CompareControls } from "./compare-controls";
import { CompareLive } from "./compare-live";
import { CompareHistory, CompareResults } from "./compare-results";
import { useRuns } from "./use-runs";

/** Start a comparison, follow it, and read the latest result and the earlier ones. */
export function CompareBoard() {
  const { snapshot } = usePipelineContext();
  // Reload the records each time a comparison finishes.
  const finished = snapshot?.control?.history.find((job) => job.action === "compare")?.id ?? null;
  const { comparisons, latest, loading, error } = useRuns(finished);

  return (
    <>
      <CompareControls />
      <CompareLive />
      <SectionTitle title="Latest comparison" lead="Measured by the control API while both architectures ran." />
      {loading ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : latest ? (
        <CompareResults record={latest} />
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-secondary text-primary">
              <GitCompareArrows className="size-5" />
            </span>
            <h2 className="font-display text-lg text-primary uppercase">No comparison yet</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              {error ??
                "Start one above. A 200,000-line comparison takes a few minutes; the full dataset about an hour at 5,000 lines/s per architecture."}
            </p>
            <p className="font-mono text-xs text-muted-foreground">or from a terminal: make compare</p>
          </CardContent>
        </Card>
      )}
      <CompareHistory records={comparisons} />
    </>
  );
}
