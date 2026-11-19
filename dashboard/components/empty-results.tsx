"use client";

import { DatabaseZap, Play } from "lucide-react";
import Link from "next/link";
import { usePipelineContext } from "@/components/pipeline/pipeline-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** Shown when MySQL holds no results yet, with a way to produce them right away. */
export function EmptyResults() {
  const { snapshot, busy, startJob } = usePipelineContext();
  const control = snapshot?.control;
  const running = (control?.active.length ?? 0) > 0;
  const replayed = snapshot?.replay.linesWritten ?? 0;

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-14 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-secondary text-primary">
          <DatabaseZap className="size-5" />
        </span>
        <h2 className="font-display text-lg text-primary uppercase">
          No batch results yet
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
          or from a terminal: make replay · make pipeline
        </p>
      </CardContent>
    </Card>
  );
}
