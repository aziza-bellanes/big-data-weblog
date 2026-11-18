"use client";

import { useNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";
import { ACTION_LABELS, usePipelineContext } from "./pipeline-context";

/** "Live" badge with the age of the last snapshot and the job running, if any. */
export function LiveIndicator({ className }: { className?: string }) {
  const { snapshot, offline } = usePipelineContext();
  const now = useNow(1000);
  const age = snapshot ? Math.max(0, Math.round((now - snapshot.takenAt) / 1000)) : null;
  const job = snapshot?.control?.current;
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <span
        className={cn(
          "inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs",
          offline ? "text-destructive" : "text-muted-foreground",
        )}
      >
        <span className="relative flex size-2">
          {!offline && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />}
          <span className={cn("relative inline-flex size-2 rounded-full", offline ? "bg-destructive" : "bg-emerald-500")} />
        </span>
        {offline ? "Offline" : age === null ? "Connecting" : age <= 2 ? "Live · updated just now" : `Live · ${age}s ago`}
      </span>
      {job && (
        <span className="inline-flex items-center gap-2 rounded-full bg-primary px-3 py-1 text-xs text-primary-foreground">
          <span className="size-1.5 animate-pulse rounded-full bg-sage" /> {ACTION_LABELS[job.action]} running
        </span>
      )}
    </div>
  );
}
