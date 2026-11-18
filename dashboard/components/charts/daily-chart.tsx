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
import { formatCompact, formatDay, formatInt } from "@/lib/format";
import type { DailyHits } from "@/lib/types";

const chartConfig = {
  hits: { label: "Requests", color: "var(--chart-1)" },
  uniqueHosts: { label: "Distinct hosts", color: "var(--chart-2)" },
} satisfies ChartConfig;

export function DailyChart({ data, compact = false }: { data: DailyHits[]; compact?: boolean }) {
  return (
    <ChartContainer config={chartConfig} className={compact ? "aspect-auto h-56 w-full" : "aspect-auto h-80 w-full"}>
      <AreaChart data={data} margin={{ left: 4, right: 4 }}>
        <defs>
          {Object.keys(chartConfig).map((key) => (
            <linearGradient key={key} id={`fill-${key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={`var(--color-${key})`} stopOpacity={0.35} />
              <stop offset="95%" stopColor={`var(--color-${key})`} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="day"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={28}
          tickFormatter={formatDay}
        />
        <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={formatCompact} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(value) => formatDay(String(value))}
              formatter={(value, name) => (
                <div className="flex w-full justify-between gap-6">
                  <span className="text-muted-foreground">
                    {chartConfig[name as keyof typeof chartConfig]?.label ?? name}
                  </span>
                  <span className="font-mono tabular-nums">{formatInt(Number(value))}</span>
                </div>
              )}
            />
          }
        />
        <Area dataKey="hits" type="monotone" stroke="var(--color-hits)" fill="url(#fill-hits)" strokeWidth={2} />
        {!compact && (
          <Area
            dataKey="uniqueHosts"
            type="monotone"
            stroke="var(--color-uniqueHosts)"
            fill="url(#fill-uniqueHosts)"
            strokeWidth={2}
          />
        )}
        {!compact && <ChartLegend content={<ChartLegendContent />} />}
      </AreaChart>
    </ChartContainer>
  );
}
