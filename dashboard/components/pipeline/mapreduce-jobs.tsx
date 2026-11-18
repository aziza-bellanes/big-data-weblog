"use client";

import { Cpu } from "lucide-react";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { YarnJob } from "@/lib/types";

const STATE_STYLES: Record<string, string> = {
  RUNNING: "bg-primary/10 text-primary",
  ACCEPTED: "bg-chart-3/15 text-chart-3",
  SUCCEEDED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  FAILED: "bg-destructive/15 text-destructive",
  KILLED: "bg-destructive/15 text-destructive",
};

/** The latest MapReduce jobs on YARN, started by Hive queries and Sqoop transfers. */
export function MapReduceJobs({ jobs }: { jobs: YarnJob[] }) {
  if (jobs.length === 0) {
    return (
      <div className="grid h-full place-items-center rounded-lg border border-dashed p-8 text-center">
        <div className="max-w-xs space-y-2">
          <Cpu className="mx-auto size-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No MapReduce job since the cluster started. Each Hive query and Sqoop transfer of the batch pipeline
            shows up here while it runs.
          </p>
        </div>
      </div>
    );
  }
  return (
    <ul className="divide-y">
      {jobs.map((job) => {
        const running = job.state === "RUNNING";
        return (
          <li key={job.id} className="flex items-center gap-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-xs" title={job.name}>
                {job.name}
              </p>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full transition-[width] duration-700", running ? "bg-primary" : "bg-sage")}
                  style={{ width: `${job.progress}%` }}
                />
              </div>
            </div>
            <span className={cn("rounded-full px-2 py-0.5 text-[0.65rem] font-medium lowercase", STATE_STYLES[job.state] ?? "bg-muted")}>
              {job.state}
            </span>
            <span className="w-14 text-right font-mono text-xs tabular-nums text-muted-foreground">
              {formatDuration(job.elapsedMs)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
