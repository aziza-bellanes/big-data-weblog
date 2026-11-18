"use client";

import { DatabaseZap, Play } from "lucide-react";
import Link from "next/link";
import { usePipelineContext } from "@/components/pipeline/pipeline-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { Architecture } from "@/lib/types";

/** Shown when MySQL holds no results yet, with a way to produce them right away. */
export function EmptyResults({ arch }: { arch: Pick<Architecture, "name" | "label"> }) {
  const { snapshot, busy, startJob } = usePipelineContext();
  const control = snapshot?.control;
  const running = control?.active.some((job) => job.arch === snapshot?.arch || job.action === "compare");
  // The live snapshot may still describe the previous architecture for a moment after a switch.
  const replayed = snapshot?.arch === arch.name ? snapshot.replay.linesWritten : 0;

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-14 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-secondary text-primary">
          <DatabaseZap className="size-5" />
        </span>
        <h2 className="font-display text-lg text-primary uppercase">
          No results yet for {arch.label}
        </h2>
        <p className="max-w-md text-sm text-muted-foreground">
          {replayed > 0
            ? "The logs are in HDFS. Run the batch pipeline: Hive analyses them and Sqoop exports the results to MySQL (about 8 minutes on the full dataset)."
            : "Replay the logs first, then run the batch pipeline: Hive analyses them and Sqoop exports the results to MySQL."}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          {replayed > 0 ? (
            <Button disabled={busy || !control || !!running} onClick={() => startJob({ action: "pipeline" })}>
              <Play /> {running ? "A job is running…" : "Run batch pipeline"}
            </Button>
          ) : (
            <Button render={<Link href="/pipeline" />}>
              <Play /> Go to the live pipeline
            </Button>
          )}
          <Button variant="outline" render={<Link href="/pipeline" />}>
            Follow it live
          </Button>
        </div>
        <p className="font-mono text-xs text-muted-foreground">
          or from a terminal: make replay ARCH={arch.name} · make pipeline ARCH={arch.name}
        </p>
      </CardContent>
    </Card>
  );
}
