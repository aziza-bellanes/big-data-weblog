"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Activity } from "lucide-react";
import type { Rates, Sample } from "@/hooks/use-pipeline";
import { formatCompact, formatInt } from "@/lib/format";

// One series per ingestion stage.
const chartConfig = {
  replay: { label: "Replayer", color: "var(--chart-3)" },
  collector: { label: "Flume → HDFS", color: "var(--chart-1)" },
  producer: { label: "Producer → Kafka", color: "var(--chart-4)" },
  writer: { label: "Kafka → HDFS", color: "var(--chart-2)" },
  spark: { label: "Kafka → Spark", color: "var(--chart-5)" },
} satisfies ChartConfig;

const clock = (t: number) =>
  new Date(t).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

/** Lines per second at each ingestion stage over the last three minutes. */
export function ThroughputChart({ history }: { history: Sample[] }) {
  const keys = Object.keys(chartConfig) as (keyof Rates)[];
  const flowing = history.some((sample) => keys.some((key) => sample[key] > 0));
  return (
    <div className="relative">
      <ChartContainer config={chartConfig} className="aspect-auto h-64 w-full">
        <AreaChart data={history} margin={{ left: 4, right: 8, top: 8 }}>
          <defs>
            {Object.keys(chartConfig).map((key) => (
              <linearGradient
                key={key}
                id={`flow-${key}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="5%"
                  stopColor={`var(--color-${key})`}
                  stopOpacity={0.3}
                />
                <stop
                  offset="95%"
                  stopColor={`var(--color-${key})`}
                  stopOpacity={0.01}
                />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="takenAt"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={48}
            tickFormatter={clock}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={44}
            tickFormatter={formatCompact}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) =>
                  clock(Number(payload?.[0]?.payload?.takenAt))
                }
                formatter={(value, name) => (
                  <div className="flex w-full justify-between gap-6">
                    <span className="text-muted-foreground">
                      {chartConfig[name as keyof typeof chartConfig]?.label ?? name}
                    </span>
                    <span className="font-mono tabular-nums">
                      {formatInt(Number(value))}/s
                    </span>
                  </div>
                )}
              />
            }
          />
          {keys.map(
            (key) => (
              <Area
                key={key}
                dataKey={key}
                type="monotone"
                stroke={`var(--color-${key})`}
                fill={`url(#flow-${key})`}
                strokeWidth={key === "replay" ? 1.5 : 2}
                strokeDasharray={key === "replay" ? "4 3" : undefined}
                isAnimationActive={false}
              />
            ),
          )}
          <ChartLegend content={<ChartLegendContent />} />
        </AreaChart>
      </ChartContainer>
      {!flowing && (
        <div className="absolute inset-x-0 top-0 bottom-10 grid place-items-center">
          <p className="flex max-w-sm flex-col items-center gap-2 rounded-lg bg-card/90 px-5 py-4 text-center text-sm text-muted-foreground">
            <Activity className="size-5 text-primary" />
            <span>
              <strong className="font-medium text-foreground">
                No lines are flowing right now.
              </strong>{" "}
              This chart follows the ingestion stages; start a replay to see it
              move. Batch steps (Hive, Sqoop) show their progress in MapReduce
              jobs.
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
