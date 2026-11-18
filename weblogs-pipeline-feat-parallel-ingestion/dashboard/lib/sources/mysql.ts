import "server-only";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { config } from "@/lib/config";
import type { MysqlStatus, Results } from "@/lib/types";

let pool: Pool | undefined;

function getPool(): Pool {
  pool ??= mysql.createPool({
    ...config.mysql,
    connectionLimit: 4,
    connectTimeout: config.requestTimeoutMs,
    // BIGINT and DECIMAL arrive as JS numbers; every count here fits comfortably.
    supportBigNumbers: true,
    decimalNumbers: true,
    dateStrings: true,
  });
  return pool;
}

async function query<T>(sql: string): Promise<T[]> {
  const [rows] = await getPool().query<RowDataPacket[]>(sql);
  return rows as T[];
}

/** Every result table exported by Sqoop, mapped to the dashboard's types. */
export async function fetchResults(): Promise<Results> {
  const [topPages, hourly, daily, statuses, topHosts, quality] = await Promise.all([
    query<Results["topPages"][number]>(
      "SELECT path, hits FROM top_pages ORDER BY hits DESC",
    ),
    query<Results["hourly"][number]>(
      `SELECT hour_of_day AS hourOfDay, hits, avg_hits_per_day AS avgHitsPerDay
       FROM hits_per_hour ORDER BY hour_of_day`,
    ),
    query<Results["daily"][number]>(
      `SELECT day, hits, client_errors AS clientErrors, server_errors AS serverErrors,
              unique_hosts AS uniqueHosts
       FROM hits_per_day ORDER BY day`,
    ),
    query<Results["statuses"][number]>(
      "SELECT status, label, category, hits, pct FROM status_distribution ORDER BY hits DESC",
    ),
    query<Results["topHosts"][number]>(
      "SELECT host, hits FROM top_hosts ORDER BY hits DESC",
    ),
    query<NonNullable<Results["quality"]>>(
      `SELECT total_lines AS totalLines, parsed_lines AS parsedLines,
              malformed_lines AS malformedLines, malformed_pct AS malformedPct
       FROM data_quality LIMIT 1`,
    ),
  ]);
  return { topPages, hourly, daily, statuses, topHosts, quality: quality[0] ?? null };
}

export async function fetchMysqlStatus(): Promise<MysqlStatus> {
  const [row] = await query<{ resultRows: number }>(
    `SELECT (SELECT COUNT(*) FROM top_pages) + (SELECT COUNT(*) FROM hits_per_hour)
          + (SELECT COUNT(*) FROM hits_per_day) + (SELECT COUNT(*) FROM status_distribution)
          + (SELECT COUNT(*) FROM top_hosts) + (SELECT COUNT(*) FROM data_quality) AS resultRows`,
  );
  const resultRows = row?.resultRows ?? 0;
  return { state: resultRows > 0 ? "active" : "idle", resultRows };
}
