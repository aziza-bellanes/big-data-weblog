"use client";

import { useState } from "react";
import { ChevronDown, CircleSlash, Loader2, Play, PlugZap, ShieldCheck, Square } from "lucide-react";
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
import { formatCompact, formatDuration } from "@/lib/format";
import type { Job, JobAction } from "@/lib/types";
import { useNow } from "@/hooks/use-now";
import { ACTION_LABELS, usePipelineContext } from "./pipeline-context";

const RATES = [1000, 2000, 5000, 10000] as const;
const SCOPES = [
  { value: "0", label: "Full dataset" },
  { value: "1000000", label: "First 1 million lines" },
  { value: "200000", label: "First 200,000 lines" },
] as const;
const SINGLE_STEPS: JobAction[] = ["hive-tables", "sqoop-import", "hive-analysis", "sqoop-export"];

/** Start the replay, the no-loss check or the batch pipeline, and stop what is running. */
export function RunPanel() {
  const { snapshot, busy, startJob, cancelJob } = usePipelineContext();
  const [rate, setRate] = useState<number>(5000);
  const [limit, setLimit] = useState<string>("0");

  const control = snapshot?.control ?? null;
  const current = control?.current ?? null;
  const blockedBy = !snapshot
    ? "Connecting…"
    : !control
      ? "The control service in the client container is not reachable. Start the stack with make up."
      : current
        ? null
        : control.replayRunning
          ? "A replay started with make replay is running."
          : null;
  const disabled = busy || !control || !!current || !!control?.replayRunning;
  const replayDone = !!control?.datasetLines && (snapshot?.replay.linesWritten ?? 0) >= control.datasetLines;

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardContent className="grid grid-cols-1 gap-px bg-border p-0 lg:grid-cols-[1.4fr_1fr_1.2fr]">
        <Block number="1" title="Replay the logs" hint="Writes the 1995 lines to access.log as live traffic.">
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
            disabled={disabled || replayDone}
            onClick={() => startJob({ action: "replay", rate, limit: Number(limit) })}
          >
            <Play /> {replayDone ? "Replay complete" : "Start replay"}
          </Button>
        </Block>

        <Block number="2" title="Check the ingestion" hint="Compares the lines replayed with the lines in HDFS.">
          <Button variant="outline" className="w-fit" disabled={disabled} onClick={() => startJob({ action: "counts" })}>
            <ShieldCheck /> Run no-loss check
          </Button>
        </Block>

        <Block number="3" title="Analyse and export" hint="Hive tables, Sqoop import, Hive analysis, Sqoop export.">
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
                {SINGLE_STEPS.map((step) => (
                  <DropdownMenuItem key={step} onClick={() => startJob({ action: step })}>
                    Only: {ACTION_LABELS[step]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </Block>
      </CardContent>

      <div className="flex flex-wrap gap-2 border-t p-4">
        {(["ingest-flume", "ingest-kafka", "ingest-sqoop", "ingest-parallel", "verify-ingestion"] as JobAction[]).map(action =>
          <Button key={action} variant="outline" disabled={busy || !control} onClick={() => startJob({action})}>
            {ACTION_LABELS[action]}
          </Button>)}
      </div>
      {control?.active?.filter(job => job.id !== current?.id).map(job =>
        <StatusStrip key={job.id} job={job} blockedBy={null} busy={busy} onCancel={cancelJob} />)}
      <StatusStrip job={current} blockedBy={blockedBy} busy={busy} onCancel={cancelJob} />
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

function StatusStrip({
  job,
  blockedBy,
  busy,
  onCancel,
}: {
  job: Job | null;
  blockedBy: string | null;
  busy: boolean;
  onCancel: (id: string) => void;
}) {
  const now = useNow(job ? 1000 : null);
  if (job) {
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
        <Button
          size="sm"
          variant="secondary"
          className="ml-auto"
          disabled={busy}
          onClick={() => onCancel(job.id)}
        >
          <Square /> Stop
        </Button>
      </div>
    );
  }
  if (blockedBy) {
    const Icon = blockedBy.startsWith("Connecting") ? Loader2 : blockedBy.includes("not reachable") ? PlugZap : CircleSlash;
    return (
      <p className="flex items-center gap-2 border-t bg-muted/60 px-5 py-3 text-xs text-muted-foreground">
        <Icon className={blockedBy.startsWith("Connecting") ? "size-3.5 animate-spin" : "size-3.5"} /> {blockedBy}
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
