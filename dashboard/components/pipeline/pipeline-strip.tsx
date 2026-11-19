"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { AnimatedNumber } from "@/components/motion";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { usePipelineContext } from "./pipeline-context";
import { buildFlow } from "./stages";
import { StateDot } from "./state-dot";

/** Compact, clickable row of every stage for the Overview page. */
export function PipelineStrip() {
  const { snapshot, rates } = usePipelineContext();
  if (!snapshot) return <Skeleton className="h-32 rounded-xl" />;
  const { items } = buildFlow(snapshot, rates);
  // Stages in reading order, each followed by its outgoing link when that link leads straight
  // to the next stage. A link followed by a new lane (B's branches end in HDFS, drawn later)
  // shows a divider instead.
  const row = items.flatMap((item, index) => {
    if (item.type !== "stage") return [];
    let next = index + 1;
    while (items[next]?.type === "lane") next += 1;
    const link = items[next];
    const connector = link?.type === "link" && items[next + 1]?.type === "stage" ? link.connector : null;
    return [{ stage: item.stage, connector, last: next >= items.length }];
  });

  return (
    <Link
      href="/pipeline"
      className="group block rounded-xl border bg-card p-4 transition-colors hover:border-primary/40"
    >
      <div className="mb-3 flex items-center justify-between">
        <p className="eyebrow text-primary">Pipeline right now</p>
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground group-hover:text-primary">
          Open the live view <ArrowUpRight className="size-3.5" />
        </span>
      </div>
      <div className="flex items-stretch overflow-x-auto pb-1">
        {row.map(({ stage, connector, last }) => {
          const Icon = stage.icon;
          return (
            <div key={stage.key} className="flex min-w-36 flex-1 items-center">
              <div className="flex-1 rounded-lg px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <Icon className="size-3.5 text-primary" />
                  <span className="truncate text-xs font-semibold">{stage.tool}</span>
                  <StateDot state={stage.state} />
                </div>
                <p className="mt-1 font-display text-lg tabular-nums">
                  <AnimatedNumber value={stage.metric} format={stage.formatMetric} />
                </p>
                <p className="truncate text-[0.68rem] text-muted-foreground">{stage.metricLabel}</p>
              </div>
              {connector ? (
                <span
                  className={cn(
                    "flow-track-x h-0.5 w-6 shrink-0",
                    connector.active ? "animate-flow-x text-primary" : "text-border",
                  )}
                  style={{ "--flow-duration": "0.8s" } as CSSProperties}
                  aria-hidden
                />
              ) : (
                !last && <span className="mx-2 h-10 w-px shrink-0 bg-border" aria-hidden />
              )}
            </div>
          );
        })}
      </div>
    </Link>
  );
}
