"use client";

import { useState } from "react";
import { GitCompareArrows } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { usePipelineContext } from "@/components/pipeline/pipeline-context";
import { RATES, SCOPES } from "@/components/pipeline/run-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatCompact, formatInt } from "@/lib/format";

/** Start a comparison: A then B on the same lines at the same rate. */
export function CompareControls() {
  const { snapshot, busy, startJob } = usePipelineContext();
  const [rate, setRate] = useState<number>(5000);
  const [limit, setLimit] = useState<string>("0");
  const [fresh, setFresh] = useState(true);

  const control = snapshot?.control ?? null;
  const running = (control?.active.length ?? 0) > 0;
  const disabled = busy || !control || running;
  const lines = Number(limit) || control?.datasetLines || 0;
  const minutes = lines ? Math.ceil((2 * lines) / rate / 60) : null;
  const start = () => startJob({ action: "compare", rate, limit: Number(limit), fresh });

  const button = (
    <Button disabled={disabled}>
      <GitCompareArrows /> Compare A and B
    </Button>
  );

  return (
    <Card className="gap-0 py-0">
      <CardContent className="flex flex-col gap-5 p-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Same lines, same rate, one after the other: A first, then B. Each run is measured from the first replayed
            line to the last row exported to MySQL, then the six result tables are compared.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup
              value={[String(rate)]}
              onValueChange={(value: string[]) => value[0] && setRate(Number(value[0]))}
              variant="outline"
              size="sm"
              aria-label="Replay rate"
            >
              {RATES.map((r) => (
                <ToggleGroupItem key={r} value={String(r)} className="font-mono text-xs">
                  {formatCompact(r)}/s
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <Select items={SCOPES} value={limit} onValueChange={(value) => value && setLimit(value)}>
              <SelectTrigger size="sm" className="min-w-40" aria-label="How many lines">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCOPES.map((scope) => (
                  <SelectItem key={scope.value} value={scope.value}>
                    {scope.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="size-4 accent-[var(--primary)]"
                checked={fresh}
                onChange={(event) => setFresh(event.target.checked)}
              />
              Empty both architectures first
            </label>
          </div>
          {minutes && (
            <p className="text-xs text-muted-foreground">
              {formatInt(lines)} lines per architecture: at least {minutes} min of replay, plus the batch parts.
            </p>
          )}
        </div>
        {fresh ? (
          <ConfirmDialog title="Empty both architectures?" confirmLabel="Empty and compare" onConfirm={start} trigger={button}>
            <p>
              The comparison starts from zero: the live logs, HDFS folders and MySQL results of A and B are deleted
              first, so both ingest exactly the same lines.
            </p>
          </ConfirmDialog>
        ) : (
          <Button disabled={disabled} onClick={start}>
            <GitCompareArrows /> Compare A and B
          </Button>
        )}
      </CardContent>
      {running && (
        <p className="border-t bg-muted/60 px-5 py-3 text-xs text-muted-foreground">
          A job is running; the comparison can start once it has finished.
        </p>
      )}
    </Card>
  );
}
