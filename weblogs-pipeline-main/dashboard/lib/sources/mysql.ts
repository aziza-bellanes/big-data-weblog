import "server-only";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { config } from "@/lib/config";
import type { MysqlStatus, Results } from "@/lib/types";

// One small pool per results database (weblogs for A, weblogs_parallel for B).
const pools = new Map<string, Pool>();

function getPool(database: string): Pool {
  let pool = pools.get(database);
  if (pool) return pool;
  pool = mysql.createPool({
    ...config.mysql,
    database,
    connectionLimit: 4,
    connectTimeout: config.requestTimeoutMs,
    // BIGINT and DECIMAL arrive as JS numbers; every count here fits comfortably.
    supportBigNumbers: true,
    decimalNumbers: true,
    dateStrings: true,
  });
  pools.set(database, pool);
  return pool;
}

/** Every result table Sqoop exported to one database, mapped to the dashboard's types. */
export async function fetchResults(database: string): Promise<Results> {
  const query = async <T,>(sql: string): Promise<T[]> => {
    const [rows] = await getPool(database).query<RowDataPacket[]>(sql);
    return rows as T[];
  };
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

export async function fetchMysqlStatus(database: string): Promise<MysqlStatus> {
  const [rows] = await getPool(database).query<RowDataPacket[]>(
    `SELECT (SELECT COUNT(*) FROM top_pages) + (SELECT COUNT(*) FROM hits_per_hour)
          + (SELECT COUNT(*) FROM hits_per_day) + (SELECT COUNT(*) FROM status_distribution)
          + (SELECT COUNT(*) FROM top_hosts) + (SELECT COUNT(*) FROM data_quality) AS resultRows`,
  );
  const resultRows = Number(rows[0]?.resultRows ?? 0);
  return { state: resultRows > 0 ? "active" : "idle", database, resultRows };
}
