"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useSpeed } from "@/hooks/use-speed";
import { formatInt } from "@/lib/format";
import { AlertKindBadge, alertUnit } from "./alert-kind";

/** The latest speed layer alerts, for the overview; the Real-time page has them all. */
export function LatestAlerts() {
  const { data, error } = useSpeed();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="eyebrow text-primary">Latest alerts</CardTitle>
        <CardDescription>
          <Link href="/realtime" className="inline-flex items-center gap-1 hover:text-foreground">
            Spark speed layer, real time <ArrowRight className="size-3" />
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!data ? (
          error ? (
            <p className="text-sm text-muted-foreground">The speed layer is not available yet.</p>
          ) : (
            <Skeleton className="h-24 w-full" />
          )
        ) : data.alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No alert so far.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {data.alerts.slice(0, 5).map((alert) => (
              <li key={`${alert.minute}|${alert.kind}|${alert.subject}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <span className="font-mono text-xs text-muted-foreground">{alert.minute}</span>
                <AlertKindBadge kind={alert.kind} />
                {alert.subject && <span className="min-w-0 truncate font-mono text-xs">{alert.subject}</span>}
                <span className="ml-auto font-mono text-xs tabular-nums">
                  {formatInt(alert.value)} {alertUnit(alert.kind)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
