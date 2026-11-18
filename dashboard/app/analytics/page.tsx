import { Suspense } from "react";
import type { Metadata } from "next";
import { DailyChart } from "@/components/charts/daily-chart";
import { HourlyChart } from "@/components/charts/hourly-chart";
import { StatusChart } from "@/components/charts/status-chart";
import { EmptyResults } from "@/components/empty-results";
import { Stagger, StaggerItem } from "@/components/motion";
import { PageBody, PageHeader, SectionTitle } from "@/components/page-header";
import { RankedTable } from "@/components/ranked-table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatHour, formatInt, formatPct } from "@/lib/format";
import { loadResults } from "@/lib/results";
import type { Results } from "@/lib/types";

export const metadata: Metadata = { title: "Analytics" };

export default function AnalyticsPage() {
  return (
    <>
      <PageHeader
        number="02"
        eyebrow="Analytics"
        title="The four questions"
        description="Answers computed by Hive over every line stored in HDFS, then exported to MySQL by Sqoop. Status labels come from the reference table Sqoop imported from MySQL."
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
  const results = await loadResults();
  if (!results) return <EmptyResults />;
  const peak = results.hourly.reduce((best, h) => (h.hits > best.hits ? h : best), results.hourly[0]);
  return (
    <Stagger className="flex flex-col gap-6">
      <StaggerItem className="flex flex-col gap-4">
        <SectionTitle number="01" title="Most visited pages" lead="Images dominate: every HTML page loads the same logos." />
        <Section title="Top 10 resources" description="Requests per path, all status codes.">
          <RankedTable labelHeader="Path" rows={results.topPages.map((p) => ({ label: p.path, hits: p.hits }))} />
        </Section>
      </StaggerItem>

      <StaggerItem className="flex flex-col gap-4">
        <SectionTitle
          number="02"
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
        <SectionTitle number="03" title="Errors" lead="Share of every HTTP status; 404 and 500 highlighted." />
        <ErrorSection results={results} />
      </StaggerItem>

      <StaggerItem className="flex flex-col gap-4">
        <SectionTitle number="04" title="Most active visitors" lead="Mostly ISP proxies that forward many users at once." />
        <Section title="Top 10 client hosts" description="Requests per host name or IP address.">
          <RankedTable labelHeader="Host" rows={results.topHosts.map((h) => ({ label: h.host, hits: h.hits }))} />
        </Section>
      </StaggerItem>

      <StaggerItem className="flex flex-col gap-4">
        <SectionTitle title="Data quality" lead="Lines the Common Log Format regex could not parse are never dropped silently." />
        <QualitySection results={results} />
      </StaggerItem>
    </Stagger>
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
