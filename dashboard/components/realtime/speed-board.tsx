"use client";

import type { ReactNode } from "react";
import { BellRing, CalendarClock, Layers, Timer, TriangleAlert, Zap } from "lucide-react";
import { SpeedChart } from "@/components/charts/speed-chart";
import { Stagger, StaggerItem } from "@/components/motion";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useNow } from "@/hooks/use-now";
import { useSpeed } from "@/hooks/use-speed";
import { formatCompact, formatDuration, formatInt } from "@/lib/format";
import type { SpeedDay, SpeedSnapshot } from "@/lib/types";
import { AlertKindBadge, alertUnit } from "./alert-kind";

/** The speed layer: Spark's progress, per-minute traffic, alerts and the check against the batch layer. */
export function SpeedBoard() {
  const { data, error } = useSpeed();

  if (!data) {
    return error ? (
      <Notice>{error}</Notice>
    ) : (
      <div className="flex flex-col gap-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  return (
    <>
      {error && <Notice>{error} Showing the last known figures.</Notice>}
      <Figures data={data} />
      {data.status.batches === 0 && data.minutes.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Spark has not processed any event yet. Start the Kafka branch from the live pipeline page (or{" "}
            <code className="font-mono">make ingest-kafka</code>) and the first figures appear within seconds.
          </CardContent>
        </Card>
      ) : (
        <>
          <Panel
            title="Traffic per minute"
            description={`Latest ${data.minutes.length} minutes of event time (1995 dates; the logs are replayed). Refreshed every 5 seconds.`}
          >
            <SpeedChart data={data.minutes} />
          </Panel>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
            <Panel
              className="xl:col-span-3"
              title="Alerts"
              description="Minutes above the 99.9th percentile of a normal minute; the latest 50."
            >
              <Alerts alerts={data.alerts} />
            </Panel>
            <Panel
              className="xl:col-span-2"
              title="Speed vs batch"
              description="Per-day totals from Spark against the Hive result exported by Sqoop."
            >
              <Reconciliation days={data.days} batchRun={data.batchRun} />
            </Panel>
          </div>
        </>
      )}
    </>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <p className="min-w-0 break-words">{children}</p>
    </div>
  );
}

function Panel({ title, description, className, children }: { title: string; description: string; className?: string; children: ReactNode }) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="eyebrow text-primary">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="min-w-0 flex-1">{children}</CardContent>
    </Card>
  );
}

function Figures({ data }: { data: SpeedSnapshot }) {
  const now = useNow(1000);
  const { status } = data;
  const age = status.lastBatchAt !== null && now > 0 ? Math.max(0, now - status.lastBatchAt) : null;
  return (
    <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <StaggerItem>
        <StatCard label="Events processed" value={formatCompact(status.events)} detail={`${formatInt(status.events)} from Kafka`} icon={Zap} />
      </StaggerItem>
      <StaggerItem>
        <StatCard label="Micro-batches" value={formatInt(status.batches)} detail="one every 5 s" icon={Layers} />
      </StaggerItem>
      <StaggerItem>
        <StatCard
          label="Last batch"
          value={age === null ? "-" : `${formatDuration(age)} ago`}
          detail={status.state === "active" ? "Spark is processing" : status.lastBatchAt === null ? "no batch yet" : "waiting for events"}
          icon={Timer}
        />
      </StaggerItem>
      <StaggerItem>
        <StatCard label="Event time reached" value={status.lastMinute?.slice(11) ?? "-"} detail={status.lastMinute?.slice(0, 10) ?? "no minute yet"} icon={CalendarClock} />
      </StaggerItem>
      <StaggerItem>
        <StatCard label="Alerts" value={formatInt(data.alertCount)} detail="since the last reset" icon={BellRing} tone={data.alertCount > 0 ? "warning" : "default"} />
      </StaggerItem>
    </Stagger>
  );
}

function Alerts({ alerts }: { alerts: SpeedSnapshot["alerts"] }) {
  if (alerts.length === 0) {
    return <p className="rounded-lg bg-muted/50 p-6 text-center text-sm text-muted-foreground">No alert so far: every minute is within the normal range.</p>;
  }
  return (
    <div className="max-h-[28rem] overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Minute</TableHead>
            <TableHead>Kind</TableHead>
            <TableHead>Subject</TableHead>
            <TableHead className="text-right">Value / threshold</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {alerts.map((alert) => (
            <TableRow key={`${alert.minute}|${alert.kind}|${alert.subject}`}>
              <TableCell className="font-mono text-xs whitespace-nowrap">{alert.minute}</TableCell>
              <TableCell>
                <AlertKindBadge kind={alert.kind} />
              </TableCell>
              <TableCell className="max-w-48 truncate font-mono text-xs" title={alert.subject}>
                {alert.subject || "-"}
              </TableCell>
              <TableCell className="text-right font-mono text-xs whitespace-nowrap tabular-nums">
                <strong className="font-medium">{formatInt(alert.value)}</strong>
                <span className="text-muted-foreground"> / {formatInt(alert.threshold)} {alertUnit(alert.kind)}</span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Both layers see the same lines, so their daily totals must be equal once the replay is complete. */
export function verdict(days: SpeedDay[], batchRun: boolean): { label: string; ok: boolean | null } {
  if (!batchRun) return { label: "Batch layer not run yet", ok: null };
  const differing = days.filter((d) => d.match === false).length;
  if (differing === 0) return { label: "Both layers agree", ok: true };
  return { label: `${differing} ${differing === 1 ? "day differs" : "days differ"}`, ok: false };
}

function Reconciliation({ days, batchRun }: { days: SpeedDay[]; batchRun: boolean }) {
  const result = verdict(days, batchRun);
  const pair = (speed: number, batch: number | undefined) => (
    <>
      {formatInt(speed)}
      <span className="text-muted-foreground"> / {batch === undefined ? "-" : formatInt(batch)}</span>
    </>
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={result.ok === false ? "destructive" : result.ok ? "default" : "secondary"}>{result.label}</Badge>
        <p className="text-xs text-muted-foreground">
          Spark / Hive. Differences are expected while the replay is still running: the batch result only covers what was in HDFS when Hive ran.
        </p>
      </div>
      {days.length > 0 && (
        <div className="max-h-96 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Day</TableHead>
                <TableHead className="text-right">Hits</TableHead>
                <TableHead className="text-right">4xx</TableHead>
                <TableHead className="text-right">5xx</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {days.map((day) => (
                <TableRow key={day.day}>
                  <TableCell className="font-mono text-xs whitespace-nowrap">{day.day}</TableCell>
                  <TableCell className="text-right font-mono text-xs whitespace-nowrap tabular-nums">{pair(day.speed.hits, day.batch?.hits)}</TableCell>
                  <TableCell className="text-right font-mono text-xs whitespace-nowrap tabular-nums">{pair(day.speed.clientErrors, day.batch?.clientErrors)}</TableCell>
                  <TableCell className="text-right font-mono text-xs whitespace-nowrap tabular-nums">{pair(day.speed.serverErrors, day.batch?.serverErrors)}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant={day.match === false ? "destructive" : day.match ? "secondary" : "outline"}>
                      {day.match === null ? "no batch" : day.match ? "match" : "mismatch"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
