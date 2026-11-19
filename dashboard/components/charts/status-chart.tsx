"use client";

import { Label, Pie, PieChart } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { formatCompact, formatInt } from "@/lib/format";
import type { StatusShare } from "@/lib/types";

// One slice per HTTP status family, coloured like the rest of the dashboard.
const chartConfig = {
  success: { label: "Success (2xx)", color: "var(--chart-1)" },
  redirection: { label: "Redirection (3xx)", color: "var(--chart-2)" },
  clientError: { label: "Client error (4xx)", color: "var(--chart-3)" },
  serverError: { label: "Server error (5xx)", color: "var(--chart-4)" },
} satisfies ChartConfig;

type Family = keyof typeof chartConfig;

function familyOf(status: number): Family {
  if (status >= 500) return "serverError";
  if (status >= 400) return "clientError";
  if (status >= 300) return "redirection";
  return "success";
}

export function StatusChart({ data }: { data: StatusShare[] }) {
  const totals = new Map<Family, number>();
  for (const row of data) {
    const family = familyOf(row.status);
    totals.set(family, (totals.get(family) ?? 0) + row.hits);
  }
  const slices = (Object.keys(chartConfig) as Family[])
    .filter((family) => totals.has(family))
    .map((family) => ({ family, hits: totals.get(family) ?? 0, fill: `var(--color-${family})` }));
  const total = slices.reduce((sum, slice) => sum + slice.hits, 0);

  return (
    <ChartContainer config={chartConfig} className="mx-auto aspect-square h-64">
      <PieChart>
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              nameKey="family"
              hideLabel
              formatter={(value, _name, item) => (
                <div className="flex w-full justify-between gap-6">
                  <span className="text-muted-foreground">
                    {chartConfig[item.payload.family as Family].label}
                  </span>
                  <span className="font-mono tabular-nums">
                    {formatInt(Number(value))} ({((Number(value) / total) * 100).toFixed(2)}%)
                  </span>
                </div>
              )}
            />
          }
        />
        <Pie data={slices} dataKey="hits" nameKey="family" innerRadius={62} strokeWidth={4} paddingAngle={1}>
          <Label
            content={({ viewBox }) =>
              viewBox && "cx" in viewBox ? (
                <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                  <tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground font-display text-xl">
                    {formatCompact(total)}
                  </tspan>
                  <tspan x={viewBox.cx} y={(viewBox.cy ?? 0) + 20} className="fill-muted-foreground text-xs">
                    requests
                  </tspan>
                </text>
              ) : null
            }
          />
        </Pie>
      </PieChart>
    </ChartContainer>
  );
}

export const statusFamilyLabel = (status: number) => chartConfig[familyOf(status)].label;
