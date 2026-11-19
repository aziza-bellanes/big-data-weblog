import { Badge } from "@/components/ui/badge";
import type { AlertKind } from "@/lib/types";

const KINDS: Record<AlertKind, { label: string; unit: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  traffic_spike: { label: "Traffic spike", unit: "hits/min", variant: "default" },
  not_found_burst: { label: "404 burst", unit: "404s/min", variant: "secondary" },
  server_errors: { label: "Server errors", unit: "5xx/min", variant: "destructive" },
  host_flood: { label: "Host flood", unit: "req/min", variant: "outline" },
};

const fallback = { label: "", unit: "", variant: "outline" } as const;

export const alertUnit = (kind: AlertKind) => (KINDS[kind] ?? fallback).unit;

export function AlertKindBadge({ kind }: { kind: AlertKind }) {
  const { label, variant } = KINDS[kind] ?? fallback;
  return <Badge variant={variant}>{label || kind}</Badge>;
}
