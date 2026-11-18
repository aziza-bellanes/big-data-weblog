"use client";

import { Check, Trophy, X } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { archLetter } from "@/lib/arch";
import { ARCH_COLORS, ARCH_ORDER, METRICS, PHASES, winner } from "@/lib/compare";
import { formatCompact, formatDuration, formatInt } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { RunRecord } from "@/lib/types";

const chartConfig = {
  sequential: { label: "A · Sequential", color: ARCH_COLORS.sequential },
  parallel: { label: "B · Parallel", color: ARCH_COLORS.parallel },
} satisfies ChartConfig;

/** The latest comparison: a verdict per metric, two charts and the result tables side by side. */
export function CompareResults({ record }: { record: RunRecord }) {
  const params = record.params;
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Comparison of {new Date(record.createdAt).toLocaleString("en-GB")} ·{" "}
        {params.limit ? `first ${formatInt(params.limit)} lines` : "full dataset"} at {formatInt(params.rate ?? 0)} lines/s
        {params.fresh ? " · both started from zero" : ""}
        {record.status !== "succeeded" && ` · ended ${record.status}`}
      </p>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <Card className="min-w-0 xl:col-span-3">
          <CardHeader>
            <CardTitle className="eyebrow text-primary">Side by side</CardTitle>
            <CardDescription>The better value is marked; within 2 % counts as a tie.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <MetricTable record={record} />
          </CardContent>
        </Card>
        <Card className="min-w-0 xl:col-span-2">
          <CardHeader>
            <CardTitle className="eyebrow text-primary">Same results?</CardTitle>
            <CardDescription>Each MySQL table, row by row (count and SHA-256 of the sorted rows).</CardDescription>
          </CardHeader>
          <CardContent>
            <ResultsMatch record={record} />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="eyebrow text-primary">Lines in HDFS over time</CardTitle>
            <CardDescription>From the first replayed line until every line is written.</CardDescription>
          </CardHeader>
          <CardContent>
            <ProgressChart record={record} />
          </CardContent>
        </Card>
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="eyebrow text-primary">Time per phase</CardTitle>
            <CardDescription>Ingestion includes waiting until every HDFS file is closed.</CardDescription>
          </CardHeader>
          <CardContent>
            <PhaseChart record={record} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricTable({ record }: { record: RunRecord }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Measure</TableHead>
          {ARCH_ORDER.map((arch) => (
            <TableHead key={arch} className="text-right">
              {chartConfig[arch].label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {METRICS.map((metric) => {
          const best = winner(metric, record);
          return (
            <TableRow key={metric.label}>
              <TableCell className="min-w-44">
                <p className="font-medium">{metric.label}</p>
                <p className="text-xs text-muted-foreground">{metric.hint}</p>
              </TableCell>
              {ARCH_ORDER.map((arch) => {
                const run = record.architectures[arch];
                const value = run ? metric.value(run) : null;
                return (
                  <TableCell
                    key={arch}
                    className={cn("text-right font-mono tabular-nums", best === arch && "font-semibold text-primary")}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {best === arch && <Trophy className="size-3.5" aria-label="better" />}
                      {value == null ? "—" : metric.format(value)}
                    </span>
                  </TableCell>
                );
              })}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function ResultsMatch({ record }: { record: RunRecord }) {
  const match = record.comparison?.resultsMatch;
  if (!match) {
    return <p className="text-sm text-muted-foreground">Not compared: the run stopped before both exports finished.</p>;
  }
  const rows = (table: string) =>
    ARCH_ORDER.map((arch) => record.architectures[arch]?.results?.[table]?.rows ?? null);
  return (
    <div className="flex flex-col gap-4">
      <p
        className={cn(
          "rounded-lg px-4 py-3 text-sm font-medium",
          record.comparison?.allResultsMatch
            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
            : "bg-destructive/15 text-destructive",
        )}
      >
        {record.comparison?.allResultsMatch
          ? "Identical: both architectures produced exactly the same six tables."
          : "Different: at least one table differs between the two architectures."}
      </p>
      <ul className="flex flex-col divide-y text-sm">
        {Object.entries(match).map(([table, same]) => {
          const [a, b] = rows(table);
          return (
            <li key={table} className="flex items-center gap-3 py-2">
              {same ? <Check className="size-4 text-emerald-600" /> : <X className="size-4 text-destructive" />}
              <code className="min-w-0 flex-1 truncate font-mono text-xs">{table}</code>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {a ?? "—"} / {b ?? "—"} rows
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ProgressChart({ record }: { record: RunRecord }) {
  const series = ARCH_ORDER.map((arch) => ({
    arch,
    data: (record.architectures[arch]?.ingestion?.samples ?? []).map((s) => ({ t: s.t, [arch]: s.inHdfs })),
  }));
  if (series.every((s) => s.data.length === 0)) {
    return <p className="py-16 text-center text-sm text-muted-foreground">No samples in this record.</p>;
  }
  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-64 w-full">
      <LineChart margin={{ left: 4, right: 12, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="t"
          type="number"
          domain={[0, "dataMax"]}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={(t: number) => formatDuration(t * 1000)}
        />
        <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={formatCompact} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => formatDuration(Number(payload?.[0]?.payload?.t) * 1000)}
              formatter={(value, name) => `${chartConfig[name as keyof typeof chartConfig]?.label}: ${formatInt(Number(value))} lines`}
            />
          }
        />
        {series.map(({ arch, data }) => (
          <Line
            key={arch}
            data={data}
            dataKey={arch}
            type="monotone"
            stroke={`var(--color-${arch})`}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        ))}
        <ChartLegend content={<ChartLegendContent />} />
      </LineChart>
    </ChartContainer>
  );
}

function PhaseChart({ record }: { record: RunRecord }) {
  const data = PHASES.map((phase) => {
    const row: Record<string, number | string> = { phase: phase.label };
    for (const arch of ARCH_ORDER) {
      const steps = record.architectures[arch]?.steps ?? {};
      row[arch] = phase.keys.reduce((sum, key) => sum + (steps[key] ?? 0), 0);
    }
    return row;
  });
  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-64 w-full">
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 12 }}>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(s: number) => formatDuration(s * 1000)} />
        <YAxis type="category" dataKey="phase" tickLine={false} axisLine={false} width={120} />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              formatter={(value, name) => `${chartConfig[name as keyof typeof chartConfig]?.label}: ${formatDuration(Number(value) * 1000)}`}
            />
          }
        />
        {ARCH_ORDER.map((arch) => (
          <Bar key={arch} dataKey={arch} fill={`var(--color-${arch})`} radius={[0, 4, 4, 0]} />
        ))}
        <ChartLegend content={<ChartLegendContent />} />
      </BarChart>
    </ChartContainer>
  );
}

/** Earlier comparisons, newest first. */
export function CompareHistory({ records }: { records: RunRecord[] }) {
  if (records.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="eyebrow text-primary">Earlier comparisons</CardTitle>
        <CardDescription>Kept by the control API in /data/runs (runs volume).</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Started</TableHead>
              <TableHead>Lines</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              {ARCH_ORDER.map((arch) => (
                <TableHead key={arch} className="text-right">
                  {archLetter(arch)}: in HDFS
                </TableHead>
              ))}
              <TableHead>Results</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.map((record) => (
              <TableRow key={record.id}>
                <TableCell className="whitespace-nowrap">{new Date(record.createdAt).toLocaleString("en-GB")}</TableCell>
                <TableCell>{record.params.limit ? formatCompact(record.params.limit) : "all"}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{formatInt(record.params.rate ?? 0)}/s</TableCell>
                {ARCH_ORDER.map((arch) => {
                  const seconds = record.architectures[arch]?.ingestion?.allWrittenSeconds;
                  return (
                    <TableCell key={arch} className="text-right font-mono tabular-nums">
                      {seconds == null ? "—" : formatDuration(seconds * 1000)}
                    </TableCell>
                  );
                })}
                <TableCell>
                  {record.comparison ? (record.comparison.allResultsMatch ? "identical" : "different") : "—"}
                </TableCell>
                <TableCell className="capitalize">{record.status}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
