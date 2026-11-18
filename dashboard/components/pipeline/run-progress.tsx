"use client";

import { History } from "lucide-react";
import { useNow } from "@/hooks/use-now";
import { formatCompact, formatDuration, formatInt } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { JobStep, PipelineSnapshot } from "@/lib/types";
import { ACTION_LABELS } from "./pipeline-context";
import { JobStatusBadge, StepIcon } from "./job-status";

/** Step-by-step progress of the current job, or a summary of the last one. */
export function RunProgress({ snapshot, replayRate }: { snapshot: PipelineSnapshot; replayRate: number }) {
  const control = snapshot.control;
  const job = control?.current ?? control?.history[0] ?? null;
  const now = useNow(job?.status === "running" ? 1000 : null);

  if (!job) {
    return (
      <div className="grid h-full place-items-center rounded-lg border border-dashed p-8 text-center">
        <div className="max-w-xs space-y-2">
          <History className="mx-auto size-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No run yet. Jobs started from this page appear here with every step, its duration and its result.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm text-primary uppercase">{ACTION_LABELS[job.action]}</p>
          <p className="text-xs text-muted-foreground">
            {job.status === "running" ? "Started" : "Ran"} at {new Date(job.createdAt).toLocaleTimeString("en-GB")}
            {" · "}
            {formatDuration((job.endedAt ?? now) - job.createdAt)}
          </p>
        </div>
        <JobStatusBadge status={job.status} />
      </div>

      {job.action === "replay" && (
        <ReplayProgress
          written={snapshot.replay.linesWritten}
          total={control?.datasetLines ?? null}
          rate={replayRate}
          running={job.status === "running"}
        />
      )}

      <ol className="relative flex flex-col gap-4 before:absolute before:top-3 before:bottom-3 before:left-3.5 before:w-px before:bg-border">
        {job.steps.map((step) => (
          <StepRow key={step.key} step={step} now={now} />
        ))}
      </ol>
    </div>
  );
}

function StepRow({ step, now }: { step: JobStep; now: number }) {
  const duration = step.startedAt ? formatDuration((step.endedAt ?? now) - step.startedAt) : null;
  return (
    <li className="flex items-center gap-3">
      <StepIcon status={step.status} />
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm", step.status === "pending" || step.status === "skipped" ? "text-muted-foreground" : "font-medium")}>
          {step.label}
        </p>
        <p className="font-mono text-[0.68rem] text-muted-foreground">make {step.key}</p>
      </div>
      {duration && <span className="font-mono text-xs tabular-nums text-muted-foreground">{duration}</span>}
    </li>
  );
}

function ReplayProgress({ written, total, rate, running }: { written: number; total: number | null; rate: number; running: boolean }) {
  const pct = total ? Math.min(100, (written / total) * 100) : 0;
  const remaining = total ? Math.max(0, total - written) : 0;
  const eta = running && rate > 0 && remaining > 0 ? formatDuration((remaining / rate) * 1000) : null;
  return (
    <div className="rounded-lg bg-muted/70 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-display text-xl tabular-nums">{pct.toFixed(1)}%</span>
        <span className="text-xs text-muted-foreground">
          {formatInt(written)} {total ? `of ${formatCompact(total)}` : ""} lines
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-background">
        <div className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span className="font-mono tabular-nums">{formatInt(rate)} lines/s</span>
        {eta && <span>about {eta} left</span>}
      </p>
    </div>
  );
}
