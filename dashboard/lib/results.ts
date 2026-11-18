import "server-only";
import { connection } from "next/server";
import { fetchResults } from "@/lib/sources/mysql";
import type { Results } from "@/lib/types";

/**
 * Results exported to MySQL by Sqoop, read on every request. Returns null when MySQL is
 * unreachable or the batch pipeline has not run yet, so pages can explain what to do.
 */
export async function loadResults(): Promise<Results | null> {
  await connection();
  try {
    const results = await fetchResults();
    return results.quality ? results : null;
  } catch {
    return null;
  }
}

/** Share of requests answered with a 4xx or 5xx status. */
export function errorRate(results: Results): number {
  const total = results.statuses.reduce((sum, row) => sum + row.hits, 0);
  const errors = results.statuses
    .filter((row) => row.status >= 400)
    .reduce((sum, row) => sum + row.hits, 0);
  return total ? (errors / total) * 100 : 0;
}

export function hitsFor(results: Results, status: number): number {
  return results.statuses.find((row) => row.status === status)?.hits ?? 0;
}
