import "server-only";
import { connection } from "next/server";
import { getArchitecture, selectedArch } from "@/lib/architectures";
import { fetchResults } from "@/lib/sources/mysql";
import type { Architecture, Results } from "@/lib/types";

export interface ArchResults {
  arch: Architecture;
  /** Null when MySQL is unreachable or the batch pipeline of this architecture has not run. */
  results: Results | null;
}

/**
 * Results Sqoop exported to the MySQL database of the selected architecture (the switch in
 * the top bar), read on every request.
 */
export async function loadResults(): Promise<ArchResults> {
  await connection();
  const arch = getArchitecture(await selectedArch());
  try {
    const results = await fetchResults(arch.mysqlDb);
    return { arch, results: results.quality ? results : null };
  } catch {
    return { arch, results: null };
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
