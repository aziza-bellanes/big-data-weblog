"use client";

import { useState } from "react";
import { ChevronDown, CircleSlash, Eraser, Loader2, Play, PlugZap, ShieldCheck, Square } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useNow } from "@/hooks/use-now";
import { formatCompact, formatDuration } from "@/lib/format";
import type { Job, JobAction } from "@/lib/types";
import { ACTION_LABELS, usePipelineContext } from "./pipeline-context";

export const RATES = [1000, 2000, 5000, 10000, 20000] as const;
export const SCOPES = [
  { value: "0", label: "Full dataset" },
  { value: "1000000", label: "First 1 million lines" },
  { value: "200000", label: "First 200,000 lines" },
] as const;

/** What the buttons do; mirrors PIPELINES in scripts/control_server.py. */
const COPY = {
  ingest: "Run the three branches",
  ingestHint:
    "At once: the log replay for Flume, JSON events through Kafka (archived to HDFS and processed by Spark) and the Sqoop import of status_codes.",
  check: "Lines replayed against HDFS; then every branch against its source.",
  batchHint: "Hive tables, branch check, Hive analysis, Sqoop export.",
  steps: ["hive-tables", "verify-ingestion", "hive-analysis", "sqoop-export"] as JobAction[],
};
const BRANCHES: JobAction[] = ["ingest-flume", "ingest-kafka", "ingest-sqoop"];

/** Run the pipeline: ingestion, checks and the batch part, and stop what is running. */
export function RunPanel() {
  const { snapshot, busy, startJob, cancelJob } = usePipelineContext();
  const [rate, setRate] = useState<number>(5000);
  const [limit, setLimit] = useState<string>("0");

  const control = snapshot?.control ?? null;
  const mine = control?.active ?? [];
  const external = !!control?.replayRunning.parallel;
  const blockedBy = !snapshot
    ? "Connecting…"
    : !control
      ? "The control service in the client container is not reachable. Start the stack with make up."
      : control.readiness && !control.readiness.ready
        ? control.readiness.problems.join(" ")
        : mine.length === 0 && external
          ? "A replay started with make replay is running."
          : null;
  const disabled = busy || !control || control.readiness?.ready === false || mine.length > 0 || external;
  // Reset can reclaim space while YARN is unhealthy; its server-side preflight
  // still refuses a read-only HDFS before touching any checkpoint.
  const resetDisabled = busy || !control || mine.length > 0 || external;
  const datasetLines = control?.datasetLines ?? 0;
  const ingested = !!datasetLines && (snapshot?.replay.linesWritten ?? 0) >= datasetLines
    && (snapshot?.producer.linesWritten ?? 0) >= datasetLines;

  if (!snapshot) return <Card className="h-44 animate-pulse" />;
  const copy = COPY;
  const branchRunning = (action: JobAction) => mine.some((job) => job.action === action);
  const onlyBranchesRunning = mine.every((job) => BRANCHES.includes(job.action));

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardContent className="grid grid-cols-1 gap-px bg-border p-0 lg:grid-cols-[1.4fr_1fr_1.2fr]">
        <Block number="1" title={copy.ingest} hint={copy.ingestHint}>
          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup
              value={[String(rate)]}
              onValueChange={(value: string[]) => value[0] && setRate(Number(value[0]))}
              variant="outline"
              size="sm"
              aria-label="Replay rate"
            >
              {RATES.map((r) => (
                <ToggleGroupItem key={r} value={String(r)} className="font-mono text-xs">
                  {formatCompact(r)}/s
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <Select items={SCOPES} value={limit} onValueChange={(value) => value && setLimit(value)}>
              <SelectTrigger size="sm" className="min-w-40" aria-label="How many lines">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCOPES.map((scope) => (
                  <SelectItem key={scope.value} value={scope.value}>
                    {scope.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            className="mt-3 w-fit"
            disabled={disabled || ingested}
            onClick={() => startJob({ action: "replay", rate, limit: Number(limit) })}
          >
            <Play /> {ingested ? "Ingestion complete" : "Start the three branches"}
          </Button>
        </Block>

        <Block number="2" title="Check the ingestion" hint={copy.check}>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="w-fit" disabled={disabled} onClick={() => startJob({ action: "counts" })}>
              <ShieldCheck /> Run no-loss check
            </Button>
            <Button variant="outline" className="w-fit" disabled={disabled} onClick={() => startJob({ action: "verify-ingestion" })}>
              <ShieldCheck /> Check every branch
            </Button>
          </div>
        </Block>

        <Block number="3" title="Analyse and export" hint={copy.batchHint}>
          <div className="flex w-fit">
            <Button className="rounded-r-none" disabled={disabled} onClick={() => startJob({ action: "pipeline" })}>
              <Play /> Run batch pipeline
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button className="rounded-l-none border-l border-primary-foreground/20 px-2" />}
                disabled={disabled}
                aria-label="Run a single step"
              >
                <ChevronDown />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {copy.steps.map((step) => (
                  <DropdownMenuItem key={step} onClick={() => startJob({ action: step })}>
                    Only: {ACTION_LABELS[step]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </Block>
      </CardContent>

      <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3">
        <span className="mr-1 text-xs text-muted-foreground">One branch on its own:</span>
        {BRANCHES.map((action) => (
          <Button
            key={action}
            size="sm"
            variant="outline"
            disabled={busy || !control || control.readiness?.ready === false || external || branchRunning(action) || !onlyBranchesRunning}
            onClick={() => startJob({ action, rate, limit: Number(limit) })}
          >
            {ACTION_LABELS[action]}
          </Button>
        ))}
        <ConfirmDialog
          title="Empty the pipeline's data?"
          confirmLabel="Empty it"
          onConfirm={() => startJob({ action: "reset" })}
          trigger={
            <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground" disabled={resetDisabled}>
              <Eraser /> Start again from zero
            </Button>
          }
        >
          <p>
            Deletes the live log and checkpoints, the HDFS folders (including the Spark speed layer&apos;s output) and the MySQL
            results, so the next run starts from the first line.
          </p>
        </ConfirmDialog>
      </div>

      {mine.map((job) => (
        <StatusStrip key={job.id} job={job} busy={busy} onCancel={cancelJob} />
      ))}
      {mine.length === 0 && <IdleStrip blockedBy={blockedBy} />}
    </Card>
  );
}

function Block({ number, title, hint, children }: { number: string; title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 bg-card p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary font-display text-xs text-primary-foreground">
          {number}
        </span>
        <div>
          <h3 className="font-display text-[0.8rem] text-primary uppercase">{title}</h3>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function StatusStrip({ job, busy, onCancel }: { job: Job; busy: boolean; onCancel: (id: string) => void }) {
  const now = useNow(1000);
  const index = job.steps.findIndex((s) => s.status === "running");
  const step = job.steps[index];
  return (
    <div className="flex flex-wrap items-center gap-3 border-t bg-primary px-5 py-3 text-sm text-primary-foreground">
      <Loader2 className="size-4 animate-spin" />
      <span className="font-medium">{ACTION_LABELS[job.action]}</span>
      {step && job.steps.length > 1 && (
        <span className="opacity-80">
          step {index + 1} of {job.steps.length}: {step.label}
        </span>
      )}
      <span className="font-mono text-xs tabular-nums opacity-80">{formatDuration(now - job.createdAt)}</span>
      <Button size="sm" variant="secondary" className="ml-auto" disabled={busy} onClick={() => onCancel(job.id)}>
        <Square /> Stop
      </Button>
    </div>
  );
}

function IdleStrip({ blockedBy }: { blockedBy: string | null }) {
  if (blockedBy) {
    const connecting = blockedBy.startsWith("Connecting");
    const Icon = connecting ? Loader2 : blockedBy.includes("not reachable") ? PlugZap : CircleSlash;
    return (
      <p className="flex items-center gap-2 border-t bg-muted/60 px-5 py-3 text-xs text-muted-foreground">
        <Icon className={connecting ? "size-3.5 animate-spin" : "size-3.5"} /> {blockedBy}
      </p>
    );
  }
  return (
    <p className="border-t bg-muted/40 px-5 py-3 text-xs text-muted-foreground">
      Ready. Each button runs the same script as its <code className="font-mono">make</code> target, in the client
      container.
    </p>
  );
}
