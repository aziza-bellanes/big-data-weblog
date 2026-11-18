"use client";

import { JobStatusBadge, StepIcon } from "@/components/pipeline/job-status";
import { usePipelineContext } from "@/components/pipeline/pipeline-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useNow } from "@/hooks/use-now";
import { archLetter } from "@/lib/arch";
import { ARCH_ORDER } from "@/lib/compare";
import { formatDuration, formatInt } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ArchName, Job } from "@/lib/types";

const NAMES: Record<ArchName, string> = { sequential: "Sequential", parallel: "Parallel" };

/** Both architectures of the running comparison, step by step, with the live ingestion figures. */
export function CompareLive() {
  const { snapshot } = usePipelineContext();
  const job = snapshot?.control?.active.find((j) => j.action === "compare") ?? null;
  const now = useNow(job ? 1000 : null);
  if (!job) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="eyebrow text-primary">Comparison in progress</CardTitle>
          <CardDescription>
            {formatInt(job.params.rate ?? 0)} lines/s
            {job.params.limit ? ` · first ${formatInt(job.params.limit)} lines` : " · full dataset"} · running for{" "}
            {formatDuration(now - job.createdAt)}
          </CardDescription>
        </div>
        <JobStatusBadge status={job.status} />
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {ARCH_ORDER.map((arch) => (
          <ArchColumn key={arch} arch={arch} job={job} now={now} />
        ))}
      </CardContent>
    </Card>
  );
}

function ArchColumn({ arch, job, now }: { arch: ArchName; job: Job; now: number }) {
  const steps = job.steps.filter((step) => step.arch === arch);
  const live = job.progress?.arch === arch ? job.progress : null;
  const active = steps.some((step) => step.status === "running");
  return (
    <section className={cn("min-w-0 rounded-lg border p-4 transition-colors", active && "border-primary/40")}>
      <h3 className="flex items-center gap-2 font-display text-sm text-primary uppercase">
        <span className="grid size-6 place-items-center rounded-md bg-primary text-xs text-primary-foreground">
          {archLetter(arch)}
        </span>
        {NAMES[arch]}
      </h3>
      {live && (
        <dl className="mt-3 grid grid-cols-3 gap-2 rounded-md bg-muted/70 p-3 text-xs">
          <Figure label={live.phase === "settle" ? "Replayed (done)" : "Replayed"} value={formatInt(live.replayed)} />
          <Figure label="In HDFS" value={formatInt(live.inHdfs)} />
          <Figure label="Kafka lag" value={live.lag === null ? "—" : formatInt(live.lag)} />
        </dl>
      )}
      <ol className="mt-3 flex flex-col gap-2">
        {steps.map((step, index) => (
          <li key={`${step.key}-${index}`} className="flex items-center gap-2.5 text-sm">
            <StepIcon status={step.status} />
            <span className={cn("min-w-0 flex-1 truncate", step.status === "pending" && "text-muted-foreground")}>
              {step.label}
            </span>
            {step.startedAt && (
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {formatDuration((step.endedAt ?? now) - step.startedAt)}
              </span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-muted-foreground">{label}</dt>
      <dd className="truncate font-mono tabular-nums">{value}</dd>
    </div>
  );
}
