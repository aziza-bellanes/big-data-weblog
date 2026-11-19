"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { formatCompact, formatHour, formatInt } from "@/lib/format";
import type { HourlyHits } from "@/lib/types";

const chartConfig = {
  avgHitsPerDay: { label: "Average requests per day", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function HourlyChart({ data }: { data: HourlyHits[] }) {
  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-72 w-full">
      <BarChart data={data} margin={{ left: 4, right: 4 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="hourOfDay"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          interval={2}
          tickFormatter={formatHour}
        />
        <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={formatCompact} />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => formatHour(Number(payload?.[0]?.payload.hourOfDay))}
              formatter={(value) => `${formatInt(Number(value))} requests / day`}
            />
          }
        />
        <Bar dataKey="avgHitsPerDay" fill="var(--color-avgHitsPerDay)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}
