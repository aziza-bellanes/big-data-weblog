import { Suspense } from "react";
import type { Metadata } from "next";
import { DailyChart } from "@/components/charts/daily-chart";
import { HourlyChart } from "@/components/charts/hourly-chart";
import { StatusChart } from "@/components/charts/status-chart";
import { EmptyResults } from "@/components/empty-results";
import { Stagger, StaggerItem } from "@/components/motion";
import { PageBody, PageHeader, ResultsSource, SectionTitle } from "@/components/page-header";
import { RankedTable } from "@/components/ranked-table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatHour, formatInt, formatPct } from "@/lib/format";
import { loadResults } from "@/lib/results";
import { alertUnit, AlertKindBadge } from "@/components/realtime/alert-kind";
import { orFallback } from "@/lib/sources/http";
import { fetchSpeedAnalytics } from "@/lib/sources/mysql";
import type { Results, SpeedAnalytics } from "@/lib/types";

export const metadata: Metadata = { title: "Analytics" };

export default function AnalyticsPage() {
  return (
    <>
      <PageHeader
        number="02"
        eyebrow="Analytics"
        title="Six questions, two layers"
        description="Questions 01–04 come from the batch layer (Flume → HDFS → Hive, exported by Sqoop), 05–06 from the speed layer (Kafka → Spark Structured Streaming → MySQL). Status labels come from the reference table Sqoop imported from MySQL."
      />
      <PageBody>
        <Suspense fallback={<Skeleton className="h-[36rem] rounded-xl" />}>
          <AnalyticsResults />
        </Suspense>
      </PageBody>
    </>
  );
}

async function AnalyticsResults() {
  const { arch, results } = await loadResults();
  if (!results) return <EmptyResults />;
  const peak = results.hourly.reduce((best, h) => (h.hits > best.hits ? h : best), results.hourly[0]);
  return (
    <Stagger className="flex flex-col gap-6">
      <ResultsSource database={arch.mysqlDb} />
      <StaggerItem className="flex flex-col gap-4">
        <SectionTitle number="01" layer="Batch · Hive" title="Most visited pages" lead="Images dominate: every HTML page loads the same logos." />
        <Section title="Top 10 resources" description="Requests per path, all status codes.">
          <RankedTable labelHeader="Path" rows={results.topPages.map((p) => ({ label: p.path, hits: p.hits }))} />
        </Section>
      </StaggerItem>

      <StaggerItem className="flex flex-col gap-4">
        <SectionTitle
          number="02"
          layer="Batch · Hive"
          title="Traffic over time"
          lead={peak ? `Busiest hour: ${formatHour(peak.hourOfDay)}, server time (UTC−4). Weekends are quieter.` : undefined}
        />
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Section title="By hour of day" description="Average requests per day for each hour.">
            <HourlyChart data={results.hourly} />
          </Section>
          <Section title="By day" description="Requests and distinct client hosts per day.">
            <DailyChart data={results.daily} />
          </Section>
        </div>
      </StaggerItem>

      <StaggerItem className="flex flex-col gap-4">
        <SectionTitle number="03" layer="Batch · Hive" title="Errors" lead="Share of every HTTP status; 404 and 500 highlighted." />
        <ErrorSection results={results} />
      </StaggerItem>

      <StaggerItem className="flex flex-col gap-4">
        <SectionTitle number="04" layer="Batch · Hive" title="Most active visitors" lead="Mostly ISP proxies that forward many users at once." />
        <Section title="Top 10 client hosts" description="Requests per host name or IP address.">
          <RankedTable labelHeader="Host" rows={results.topHosts.map((h) => ({ label: h.host, hits: h.hits }))} />
        </Section>
      </StaggerItem>

      <StaggerItem className="flex flex-col gap-4">
        <SectionTitle layer="Batch · Hive" title="Data quality" lead="Lines the Common Log Format regex could not parse are never dropped silently." />
        <QualitySection results={results} />
      </StaggerItem>

      <SpeedSections database={arch.mysqlDb} />
    </Stagger>
  );
}

async function SpeedSections({ database }: { database: string }) {
  const speed = await orFallback("speed-analytics", () => fetchSpeedAnalytics(database), null);
  const empty = !speed || (speed.alerts.length === 0 && speed.days.every((d) => d.speed.hits === 0));
  return (
    <>
      <StaggerItem className="flex flex-col gap-4">
        <SectionTitle
          number="05"
          layer="Speed · Spark"
          title="Suspicious activity"
          lead="Minutes the stream flagged above the 99.9th percentile of a normal minute: suspicious patterns, not proven attacks."
        />
        {empty || !speed ? <EmptyNote>No speed layer results yet. Replay the log through Kafka to fill them.</EmptyNote> : <AlertsSection speed={speed} />}
      </StaggerItem>
      <StaggerItem className="flex flex-col gap-4">
        <SectionTitle
          number="06"
          layer="Batch vs speed"
          title="Do both layers agree?"
          lead="Spark's per-minute counts, summed per day, against Hive's hits_per_day."
        />
        {empty || !speed ? <EmptyNote>No speed layer results yet.</EmptyNote> : <AgreementSection speed={speed} />}
      </StaggerItem>
    </>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">{children}</p>;
}

const KIND_ORDER = ["traffic_spike", "not_found_burst", "server_errors", "host_flood"] as const;

function AlertsSection({ speed }: { speed: SpeedAnalytics }) {
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {KIND_ORDER.map((kind) => {
          const alert = speed.alerts.find((a) => a.kind === kind);
          return (
            <Card key={kind}>
              <CardHeader>
                <CardTitle>
                  <AlertKindBadge kind={kind} />
                </CardTitle>
                <CardDescription>{alert ? `Threshold ≥ ${formatInt(alert.threshold)} ${alertUnit(kind)}` : "No minute flagged"}</CardDescription>
              </CardHeader>
              {alert && (
                <CardContent>
                  <p className="font-display text-2xl tabular-nums">{formatInt(alert.flagged)}</p>
                  <p className="eyebrow text-muted-foreground">flagged minutes</p>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Worst: <span className="font-mono tabular-nums">{formatInt(alert.worstValue)}</span> {alertUnit(kind)} at{" "}
                    <span className="font-mono">{alert.worstMinute}</span>
                    {alert.worstSubject && (
                      <>
                        {" "}from <span className="font-mono break-all">{alert.worstSubject}</span>
                      </>
                    )}
                  </p>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
      {speed.floodHosts.length > 0 && (
        <Section title="Top flooding hosts" description="Hosts flagged most often for one-minute request floods.">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Host</TableHead>
                <TableHead className="text-right">Flagged minutes</TableHead>
                <TableHead className="text-right">Max requests in one minute</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {speed.floodHosts.map((h) => (
                <TableRow key={h.host}>
                  <TableCell className="font-mono text-xs">{h.host}</TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">{formatInt(h.flaggedMinutes)}</TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">{formatInt(h.maxRequests)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}
    </>
  );
}

function AgreementSection({ speed }: { speed: SpeedAnalytics }) {
  if (!speed.batchRun) return <EmptyNote>The batch layer has not exported hits_per_day yet.</EmptyNote>;
  const matching = speed.days.filter((d) => d.match === true).length;
  const num = "text-right font-mono text-xs tabular-nums";
  return (
    <Section title={`${matching} of ${speed.days.length} days match`} description="A day matches when hits, 4xx and 5xx are all equal.">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Day</TableHead>
            <TableHead className="text-right">Hive hits</TableHead>
            <TableHead className="text-right">Spark hits</TableHead>
            <TableHead className="text-right">Hive 4xx</TableHead>
            <TableHead className="text-right">Spark 4xx</TableHead>
            <TableHead className="text-right">Hive 5xx</TableHead>
            <TableHead className="text-right">Spark 5xx</TableHead>
            <TableHead className="text-right">Match</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {speed.days.map((d) => (
            <TableRow key={d.day}>
              <TableCell className="font-mono text-xs">{d.day}</TableCell>
              <TableCell className={num}>{d.batch ? formatInt(d.batch.hits) : "-"}</TableCell>
              <TableCell className={num}>{formatInt(d.speed.hits)}</TableCell>
              <TableCell className={num}>{d.batch ? formatInt(d.batch.clientErrors) : "-"}</TableCell>
              <TableCell className={num}>{formatInt(d.speed.clientErrors)}</TableCell>
              <TableCell className={num}>{d.batch ? formatInt(d.batch.serverErrors) : "-"}</TableCell>
              <TableCell className={num}>{formatInt(d.speed.serverErrors)}</TableCell>
              <TableCell className="text-right">
                <Badge variant={d.match === false ? "destructive" : d.match ? "secondary" : "outline"}>
                  {d.match === null ? "no batch" : d.match ? "match" : "mismatch"}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Section>
  );
}

function ErrorSection({ results }: { results: Results }) {
  return (
    <Section title="Status codes" description="Labels joined from the status_codes table imported by Sqoop.">
      <div className="grid items-center gap-6 lg:grid-cols-[18rem_1fr]">
        <StatusChart data={results.statuses} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Meaning</TableHead>
              <TableHead className="text-right">Requests</TableHead>
              <TableHead className="text-right">Share</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {results.statuses.map((row) => {
              const highlighted = row.status === 404 || row.status === 500;
              return (
                <TableRow key={row.status} className={highlighted ? "bg-chart-3/10" : undefined}>
                  <TableCell className="font-mono">{row.status}</TableCell>
                  <TableCell>
                    <span className="mr-2">{row.label ?? "Unknown"}</span>
                    {row.category && <Badge variant="secondary">{row.category}</Badge>}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">{formatInt(row.hits)}</TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">{formatPct(row.pct, 4)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </Section>
  );
}

function QualitySection({ results }: { results: Results }) {
  const quality = results.quality;
  if (!quality) return null;
  const items = [
    ["Lines in HDFS", formatInt(quality.totalLines)],
    ["Parsed by the regex", formatInt(quality.parsedLines)],
    ["Malformed, kept and counted", formatInt(quality.malformedLines)],
    ["Malformed share", formatPct(quality.malformedPct, 3)],
  ] as const;
  return (
    <Section title="Parsing" description="Every line in HDFS, split by the regular expression of the Hive table.">
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {items.map(([label, value]) => (
          <div key={label} className="rounded-lg bg-muted px-4 py-3">
            <dt className="eyebrow text-muted-foreground">{label}</dt>
            <dd className="mt-1 font-display text-xl tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="eyebrow text-primary">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
