import { Check, CircleDashed, Loader2, Minus, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { JobStatus, StepStatus } from "@/lib/types";

const BADGES: Record<JobStatus, { label: string; light: string; dark: string }> = {
  running: { label: "Running", light: "bg-primary/10 text-primary", dark: "bg-white/15 text-white" },
  succeeded: { label: "Succeeded", light: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", dark: "bg-emerald-400/20 text-emerald-200" },
  failed: { label: "Failed", light: "bg-destructive/15 text-destructive", dark: "bg-red-400/20 text-red-200" },
  cancelled: { label: "Stopped", light: "bg-muted text-muted-foreground", dark: "bg-white/10 text-white/70" },
};

export function JobStatusBadge({ status, onDark = false }: { status: JobStatus; onDark?: boolean }) {
  const badge = BADGES[status];
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[0.65rem] font-medium", onDark ? badge.dark : badge.light)}>
      {badge.label}
    </span>
  );
}

const STEP_ICONS: Record<StepStatus, { icon: typeof Check; className: string }> = {
  pending: { icon: CircleDashed, className: "border-border bg-card text-muted-foreground" },
  running: { icon: Loader2, className: "border-primary bg-primary text-primary-foreground [&>svg]:animate-spin" },
  succeeded: { icon: Check, className: "border-emerald-500 bg-emerald-500 text-white" },
  failed: { icon: X, className: "border-destructive bg-destructive text-white" },
  cancelled: { icon: Square, className: "border-border bg-muted text-muted-foreground" },
  skipped: { icon: Minus, className: "border-border bg-muted text-muted-foreground" },
};

export function StepIcon({ status }: { status: StepStatus }) {
  const { icon: Icon, className } = STEP_ICONS[status];
  return (
    <span className={cn("relative z-10 grid size-7 shrink-0 place-items-center rounded-full border-2", className)}>
      <Icon className="size-3.5" />
    </span>
  );
}
