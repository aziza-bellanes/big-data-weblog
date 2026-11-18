import { Suspense } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { DailyChart } from "@/components/charts/daily-chart";
import { EmptyResults } from "@/components/empty-results";
import { Stagger, StaggerItem } from "@/components/motion";
import { PageBody, PageHeader, SectionTitle } from "@/components/page-header";
import { LiveIndicator } from "@/components/pipeline/live-indicator";
import { PipelineStrip } from "@/components/pipeline/pipeline-strip";
import { RankedTable } from "@/components/ranked-table";
import { TemplateBars } from "@/components/template-bars";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCompact, formatDay, formatHour, formatInt, formatPct } from "@/lib/format";
import { errorRate, hitsFor, loadResults } from "@/lib/results";
import type { Results } from "@/lib/types";

export default function OverviewPage() {
  return (
    <>
      <PageHeader
        number="01"
        eyebrow="Overview"
        title="NASA web traffic"
        description="Two months of requests to the NASA Kennedy Space Center web server (July and August 1995), ingested through independent Flume and Kafka branches into separate HDFS zones, analysed with Hive and exported to MySQL with Sqoop."
        aside={<LiveIndicator />}
      />
      <PageBody>
        <Suspense fallback={<OverviewSkeleton />}>
          <OverviewResults />
        </Suspense>
      </PageBody>
    </>
  );
}

async function OverviewResults() {
  const results = await loadResults();
  if (!results?.quality) {
    return (
      <>
        <PipelineStrip />
        <EmptyResults />
      </>
    );
  }
  return (
    <>
      <Hero results={results} />
      <PipelineStrip />
      <SectionTitle title="Questions, answered" lead="What Hive found in every line stored in HDFS." />
      <Answers results={results} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader>
            <CardTitle className="eyebrow text-primary">Requests per day</CardTitle>
            <CardDescription>One HDFS partition per day, from the request time inside each line.</CardDescription>
          </CardHeader>
          <CardContent>
            <DailyChart data={results.daily} compact />
          </CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="eyebrow text-primary">Most requested</CardTitle>
            <CardDescription>
              <Link href="/analytics" className="inline-flex items-center gap-1 hover:text-foreground">
                Full analytics <ArrowRight className="size-3" />
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RankedTable labelHeader="Path" rows={results.topPages.slice(0, 5).map((p) => ({ label: p.path, hits: p.hits }))} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

/** Navy band with the headline figures, framed by the template's block bars. */
function Hero({ results }: { results: Results }) {
  const { quality, daily } = results;
  if (!quality) return null;
  const figures = [
    { value: formatCompact(quality.totalLines), label: "requests", detail: `${formatInt(quality.totalLines)} log lines` },
    {
      value: String(daily.length),
      label: "days",
      detail: daily.length ? `${formatDay(daily[0].day)} → ${formatDay(daily[daily.length - 1].day)} 1995` : "",
    },
    { value: formatPct(errorRate(results)), label: "errors", detail: "4xx and 5xx responses" },
    { value: formatInt(quality.malformedLines), label: "malformed lines", detail: "kept and counted, never dropped" },
  ];
  return (
    <section className="overflow-hidden rounded-xl bg-navy text-cream shadow-sm">
      <TemplateBars className="h-2 [&>span:nth-child(odd)]:bg-[oklch(0.33_0.07_238)]" />
      <Stagger className="grid grid-cols-1 gap-px bg-white/10 sm:grid-cols-2 xl:grid-cols-4">
        {figures.map((figure) => (
          <StaggerItem key={figure.label} className="bg-navy px-6 py-7">
            <p className="font-display text-4xl leading-none tabular-nums">{figure.value}</p>
            <p className="eyebrow mt-3 text-sage">{figure.label}</p>
            <p className="mt-1 text-xs text-cream/70">{figure.detail}</p>
          </StaggerItem>
        ))}
      </Stagger>
    </section>
  );
}

/** The four questions of the project, each answered in one figure. */
function Answers({ results }: { results: Results }) {
  const peak = results.hourly.reduce((best, h) => (h.hits > best.hits ? h : best), results.hourly[0]);
  const top = results.topPages[0];
  const host = results.topHosts[0];
  const notFound = hitsFor(results, 404);
  const total = results.quality?.totalLines || 1;
  const answers = [
    { question: "Most visited page", answer: top?.path ?? "-", detail: top ? `${formatInt(top.hits)} requests` : "" },
    {
      question: "Busiest hour",
      answer: peak ? formatHour(peak.hourOfDay) : "-",
      detail: peak ? `${formatInt(peak.avgHitsPerDay)} requests per day on average` : "",
    },
    { question: "Pages not found", answer: formatPct((notFound / total) * 100), detail: `${formatInt(notFound)} × 404` },
    { question: "Most active visitor", answer: host?.host ?? "-", detail: host ? `${formatInt(host.hits)} requests` : "" },
  ];
  return (
    <Stagger className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {answers.map((item, index) => (
        <StaggerItem key={item.question}>
          <Link
            href="/analytics"
            className="group relative flex h-full flex-col overflow-hidden rounded-xl border bg-card p-5 transition-colors hover:border-primary/40"
          >
            <span className="pointer-events-none absolute -top-3 -right-1 font-display text-6xl text-primary/[0.06]" aria-hidden>
              {String(index + 1).padStart(2, "0")}
            </span>
            <p className="eyebrow text-muted-foreground">{item.question}</p>
            <p className="mt-3 line-clamp-2 font-display text-lg leading-snug break-all text-primary [font-stretch:110%]" title={item.answer}>
              {item.answer}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
          </Link>
        </StaggerItem>
      ))}
    </Stagger>
  );
}

function OverviewSkeleton() {
  return (
    <>
      <Skeleton className="h-40 rounded-xl" />
      <Skeleton className="h-32 rounded-xl" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
    </>
  );
}
