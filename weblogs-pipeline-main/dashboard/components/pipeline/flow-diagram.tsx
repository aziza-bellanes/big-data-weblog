"use client";

import type { CSSProperties } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { AnimatedNumber } from "@/components/motion";
import { cn } from "@/lib/utils";
import type { Connector, Direction, Flow, Stage } from "./stages";
import { StateDot } from "./state-dot";

/**
 * The live diagram of one architecture. Each item carries its own place on the wide-screen grid
 * (stages.ts): A is a "snake" like the report's diagram, B three branches merging into HDFS.
 * Below xl, everything stacks in reading order.
 */
export function FlowDiagram({ flow }: { flow: Flow }) {
  return (
    <div className={cn("grid grid-cols-1", flow.grid)}>
      {flow.items.map((item, index) => {
        if (item.type === "lane") return <LaneLabel key={`lane-${index}`} className={item.place}>{item.label}</LaneLabel>;
        if (item.type === "stage") return <FlowNode key={item.stage.key} stage={item.stage} className={item.place} />;
        return <FlowConnector key={`link-${index}`} connector={item.connector} direction={item.direction} className={item.place} />;
      })}
    </div>
  );
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
          <AnimatedNumber value={stage.metric} format={stage.formatMetric} />
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

/** Animation period of the dashes: faster with more throughput, within readable bounds. */
function flowDuration(rate: number): string {
  if (rate <= 0) return "1.2s";
  return `${Math.min(1.6, Math.max(0.3, 3000 / rate)).toFixed(2)}s`;
}

function FlowConnector({
  connector,
  direction,
  className,
}: {
  connector: Connector;
  direction: Direction;
  className?: string;
}) {
  const { active } = connector;
  const style = { "--flow-duration": flowDuration(connector.rate) } as CSSProperties;
  const tone = active ? "text-primary" : "text-border";
  const vertical = cn("flow-track-y absolute inset-y-1 left-1/2 w-0.5 -translate-x-1/2", tone, active && "animate-flow-y");
  const Arrow = direction === "backward" ? ChevronLeft : ChevronRight;

  return (
    <div className={cn("relative h-12 xl:h-auto", direction === "down" && "xl:h-full", className)} style={style}>
      {/* Vertical track: always for the turn into HDFS, otherwise only on narrow screens. */}
      <span className={cn(vertical, direction !== "down" && "xl:hidden")} />
      <ChevronDown
        className={cn("absolute -bottom-1.5 left-1/2 size-4 -translate-x-1/2", tone, direction !== "down" && "xl:hidden")}
      />
      {direction !== "down" && (
        <>
          <span
            className={cn(
              "flow-track-x absolute inset-x-1 top-1/2 hidden h-0.5 -translate-y-1/2 xl:block",
              tone,
              active && (direction === "forward" ? "animate-flow-x" : "animate-flow-x-reverse"),
            )}
          />
          <Arrow
            className={cn(
              "absolute top-1/2 hidden size-4 -translate-y-1/2 xl:block",
              direction === "forward" ? "-right-1.5" : "-left-1.5",
              tone,
            )}
          />
        </>
      )}
      <span
        className={cn(
          "absolute top-1/2 left-[calc(50%+0.9rem)] -translate-y-1/2 rounded-full border bg-card px-2 py-0.5 font-mono text-[0.62rem] whitespace-nowrap tabular-nums transition-colors",
          direction !== "down" && "xl:top-[calc(50%-1.35rem)] xl:left-1/2 xl:-translate-x-1/2",
          active ? "border-primary/30 text-primary" : "text-muted-foreground",
        )}
      >
        {connector.label}
      </span>
    </div>
  );
}
