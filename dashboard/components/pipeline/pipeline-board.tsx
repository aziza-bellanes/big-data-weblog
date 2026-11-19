"use client";

import type { ReactNode } from "react";
import { WifiOff } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatInt } from "@/lib/format";
import { FlowDiagram } from "./flow-diagram";
import { LogConsole } from "./log-console";
import { MapReduceJobs } from "./mapreduce-jobs";
import { usePipelineContext } from "./pipeline-context";
import { RunPanel } from "./run-panel";
import { latestJob, RunProgress } from "./run-progress";
import { buildFlow } from "./stages";
import { ThroughputChart } from "./throughput-chart";

/** Controls, live flow, run progress, throughput, console and MapReduce jobs. */
export function PipelineBoard() {
  const { snapshot, rates, history, offline } = usePipelineContext();

  if (!snapshot) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-44 rounded-xl" />
        <Skeleton className="h-[30rem] rounded-xl" />
      </div>
    );
  }

  const flow = buildFlow(snapshot, rates);
  const job = latestJob(snapshot);
  const lag = snapshot.kafka.consumerLag;
  const writer = "kafka-hdfs-writer";

  return (
    <>
      {offline && (
        <p className="flex items-center gap-2 rounded-lg bg-destructive/10 px-4 py-2 text-sm text-destructive">
          <WifiOff className="size-4" /> Lost contact with the dashboard server; showing the last known state.
        </p>
      )}

      <RunPanel />

      <Panel
        title="Data flow"
        description="Three independent branches into HDFS (Kafka feeds an archive writer and the Spark speed layer), then the batch part. Probed every two seconds; moving dashes mean data is flowing."
      >
        <FlowDiagram flow={flow} />
      </Panel>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <Panel className="xl:col-span-3" title="Throughput" description="Lines per second at each ingestion stage, last three minutes.">
          <ThroughputChart history={history} />
          <p className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 border-t pt-4 text-xs text-muted-foreground">
            <span>
              Kafka consumer lag{" "}
              <strong className="font-mono text-foreground tabular-nums">{formatInt(lag)}</strong>
            </span>
            <span>
              {lag > 0
                ? `Messages are waiting in Kafka for ${writer}; they are not lost.`
                : `${writer} is caught up. Stop it (docker compose stop ${writer}) to watch Kafka buffer.`}
            </span>
          </p>
        </Panel>
        <Panel className="xl:col-span-2" title="Current run" description="Started from this page; each step is a make target.">
          <RunProgress snapshot={snapshot} replayRate={rates.replay} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <LogConsole job={job} />
        </div>
        <Panel className="xl:col-span-2" title="MapReduce jobs" description="Hive queries and Sqoop transfers, live from YARN.">
          <MapReduceJobs jobs={snapshot.yarn.recent} />
        </Panel>
      </div>
    </>
  );
}

function Panel({
  title,
  description,
  className,
  children,
}: {
  title: string;
  description: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="eyebrow text-primary">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1">{children}</CardContent>
    </Card>
  );
}
