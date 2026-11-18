import { cn } from "@/lib/utils";
import type { StageState } from "@/lib/types";

const STYLES: Record<StageState, { dot: string; label: string }> = {
  active: { dot: "bg-emerald-500", label: "Flowing" },
  idle: { dot: "bg-chart-2", label: "Idle" },
  down: { dot: "bg-destructive", label: "Unreachable" },
};

export function StateDot({ state, withLabel = false }: { state: StageState; withLabel?: boolean }) {
  const { dot, label } = STYLES[state];
  return (
    <span className="inline-flex items-center gap-1.5" title={label}>
      <span className="relative flex size-2.5">
        {state === "active" && (
          <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-60", dot)} />
        )}
        <span className={cn("relative inline-flex size-2.5 rounded-full", dot)} />
      </span>
      {withLabel && <span className="text-xs text-muted-foreground">{label}</span>}
    </span>
  );
}
