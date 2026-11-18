import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string;
  detail?: string;
  icon: LucideIcon;
  tone?: "default" | "warning" | "danger";
}

const TONES = {
  default: "bg-secondary text-secondary-foreground",
  warning: "bg-chart-3/15 text-chart-3",
  danger: "bg-chart-4/15 text-chart-4",
} as const;

export function StatCard({ label, value, detail, icon: Icon, tone = "default" }: StatCardProps) {
  return (
    <Card className="gap-0 py-5">
      <CardContent className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow text-muted-foreground">{label}</p>
          <p className="mt-2 font-display text-2xl tabular-nums text-foreground">{value}</p>
          {detail && <p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p>}
        </div>
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", TONES[tone])}>
          <Icon className="size-4" />
        </span>
      </CardContent>
    </Card>
  );
}
