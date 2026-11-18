import "server-only";
import { config } from "@/lib/config";
import { getJson } from "@/lib/sources/http";
import type { YarnJob, YarnStatus } from "@/lib/types";

interface YarnApp {
  id: string;
  name: string;
  state: string;
  finalStatus: string;
  progress: number;
  elapsedTime: number;
  startedTime: number;
}

const RECENT_JOBS = 6;

/** MapReduce jobs launched by Hive queries and Sqoop transfers. */
export async function fetchYarnStatus(): Promise<YarnStatus> {
  const body = await getJson<{ apps: { app: YarnApp[] } | null }>(
    `${config.yarnUrl}/ws/v1/cluster/apps`,
  );
  const apps = body.apps?.app ?? [];
  const running = apps.filter((a) => a.state === "RUNNING" || a.state === "ACCEPTED").length;
  const recent: YarnJob[] = [...apps]
    .sort((a, b) => b.startedTime - a.startedTime)
    .slice(0, RECENT_JOBS)
    .map((a) => ({
      id: a.id,
      // Hive names jobs after the query text; keep the first line only.
      name: a.name.split("\n")[0].trim(),
      state: a.state === "FINISHED" ? a.finalStatus : a.state,
      progress: Math.round(a.progress),
      elapsedMs: a.elapsedTime,
    }));
  return {
    state: running > 0 ? "active" : "idle",
    running,
    completed: apps.filter((a) => a.finalStatus === "SUCCEEDED").length,
    failed: apps.filter((a) => a.finalStatus === "FAILED" || a.finalStatus === "KILLED").length,
    recent,
  };
}
