"use client";

import { Area, AreaChart, CartesianGrid, Line, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatCompact, formatInt } from "@/lib/format";
import type { SpeedMinute } from "@/lib/types";

const chartConfig = {
  hits: { label: "Requests", color: "var(--chart-1)" },
  clientErrors: { label: "Client errors (4xx)", color: "var(--chart-3)" },
  serverErrors: { label: "Server errors (5xx)", color: "var(--chart-4)" },
} satisfies ChartConfig;

/** "1995-07-13 10:42" -> "10:42" */
const clock = (minute: string) => minute.slice(11);

/** Requests per minute of event time, with the errors, for the latest minutes Spark computed. */
export function SpeedChart({ data }: { data: SpeedMinute[] }) {
  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-72 w-full">
      <AreaChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
        <defs>
          <linearGradient id="fill-speed-hits" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-hits)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--color-hits)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="minute" tickLine={false} axisLine={false} tickMargin={8} minTickGap={40} tickFormatter={clock} />
        <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={formatCompact} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => String(payload?.[0]?.payload?.minute ?? "")}
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
        <Area
          dataKey="hits"
          type="monotone"
          stroke="var(--color-hits)"
          fill="url(#fill-speed-hits)"
          strokeWidth={2}
          isAnimationActive={false}
        />
        <Line dataKey="clientErrors" type="monotone" stroke="var(--color-clientErrors)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
        <Line dataKey="serverErrors" type="monotone" stroke="var(--color-serverErrors)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
        <ChartLegend content={<ChartLegendContent />} />
      </AreaChart>
    </ChartContainer>
  );
}
