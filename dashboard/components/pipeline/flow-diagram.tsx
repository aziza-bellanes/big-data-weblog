"use client";

import { AnimatedNumber } from "@/components/motion";
import { cn } from "@/lib/utils";
import type { Flow, Stage } from "./stages";
import { StateDot } from "./state-dot";

export function FlowDiagram({ flow }: { flow: Flow }) {
  const { stages } = flow;
  return <div className="space-y-5">
    <LaneLabel>Independent ingestion branches</LaneLabel>
    <div className="grid gap-4 md:grid-cols-3">
      {stages.slice(0, 3).map(stage => <div key={stage.key} className="space-y-3">
        <FlowNode stage={stage} />
        <p className="text-center text-sm text-muted-foreground">↓ HDFS</p>
      </div>)}
    </div>
    <p className="text-xs text-muted-foreground">Flume is canonical. Kafka contains another representation of the same NASA requests. Sqoop imports reference data.</p>
    <LaneLabel>Storage, batch analysis and reporting</LaneLabel>
    <div className="grid gap-4 md:grid-cols-4">
      {stages.slice(3).map(stage => <FlowNode key={stage.key} stage={stage} />)}
    </div>
  </div>;
}

function LaneLabel({ className, children }: { className?: string; children: string }) {
  return (
    <p className={cn("eyebrow flex items-center gap-3 text-muted-foreground", className)}>
      {children}
      <span className="h-px flex-1 bg-border" />
    </p>
  );
}

const NODE_STATE = {
  active: "border-primary/40 shadow-[0_0_0_4px_color-mix(in_oklch,var(--primary)_10%,transparent)]",
  idle: "",
  down: "border-destructive/40 bg-destructive/5",
} as const;

function FlowNode({ stage, className }: { stage: Stage; className?: string }) {
  const Icon = stage.icon;
  const active = stage.state === "active";
  return (
    <article
      className={cn(
        "relative flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 transition-[border-color,box-shadow] duration-500",
        NODE_STATE[stage.state],
        className,
      )}
    >
      <header className="space-y-2">
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-lg transition-colors duration-500",
              active ? "bg-primary text-primary-foreground" : "bg-secondary text-primary",
            )}
          >
            <Icon className="size-4" />
          </span>
          <h3 className="min-w-0 flex-1 truncate font-display text-[0.8rem] text-primary uppercase [font-stretch:105%]">
            {stage.tool}
          </h3>
          <StateDot state={stage.state} />
        </div>
        <p className="truncate font-mono text-[0.68rem] text-muted-foreground" title={stage.role}>
          {stage.role}
        </p>
      </header>

      <div>
        <p className="font-display text-2xl leading-none tabular-nums">
          {stage.state === "down" ? "Unavailable" : <AnimatedNumber value={stage.metric} format={stage.formatMetric} />}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{stage.metricLabel}</p>
      </div>

      {stage.progress && (
        <div className="space-y-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
              style={{ width: `${stage.progress.value}%` }}
            />
          </div>
          <p className="flex justify-between gap-2 text-[0.68rem] text-muted-foreground">
            <span className="truncate" title={stage.progress.label}>
              {stage.progress.label}
            </span>
            <span className="font-mono tabular-nums">{stage.progress.value.toFixed(0)}%</span>
          </p>
        </div>
      )}

      {stage.details.length > 0 && (
        <dl className="mt-auto flex gap-5 border-t pt-3 text-[0.7rem]">
          {stage.details.map((detail) => (
            <div key={detail.label} className="min-w-0">
              <dt className="text-muted-foreground">{detail.label}</dt>
              <dd className="truncate font-mono tabular-nums">{detail.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </article>
  );
}

