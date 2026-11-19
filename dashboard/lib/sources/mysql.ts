import "server-only";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { config } from "@/lib/config";
import type { AlertSummary, FloodHost, MysqlStatus, SpeedAnalytics, Results, SparkStatus, SpeedAlert, SpeedDay, SpeedMinute, SpeedSnapshot } from "@/lib/types";

// One small pool per database.
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

// ---- Speed layer: serving tables written by Spark Structured Streaming ----

/** A micro-batch every 5 s while events arrive; quiet for longer than this means idle. */
const SPARK_ACTIVE_MS = 15_000;
const SPEED_MINUTES = 180;
const SPEED_ALERTS = 50;

/** What Spark has processed so far, from speed_batches (one row per micro-batch). */
export async function fetchSparkStatus(database: string): Promise<SparkStatus> {
  const [rows] = await getPool(database).query<RowDataPacket[]>(
    `SELECT COUNT(*) AS batches, COALESCE(SUM(events), 0) AS events,
            ROUND(UNIX_TIMESTAMP(MAX(processed_at)) * 1000) AS lastBatchAt,
            MAX(last_minute) AS lastMinute
     FROM speed_batches`,
  );
  const row = rows[0] ?? {};
  const lastBatchAt = row.lastBatchAt === null || row.lastBatchAt === undefined ? null : Number(row.lastBatchAt);
  return {
    state: lastBatchAt !== null && Date.now() - lastBatchAt < SPARK_ACTIVE_MS ? "active" : "idle",
    batches: Number(row.batches ?? 0),
    events: Number(row.events ?? 0),
    lastBatchAt,
    lastMinute: (row.lastMinute as string | null) ?? null,
  };
}

type Totals = SpeedDay["speed"];

/** Per-minute traffic, alerts and the day-by-day reconciliation with the batch layer. */
export async function fetchSpeed(database: string): Promise<SpeedSnapshot> {
  const query = async <T,>(sql: string): Promise<T[]> => {
    const [rows] = await getPool(database).query<RowDataPacket[]>(sql);
    return rows as T[];
  };
  const [status, alertCount, latest, alerts, speedDays, batchDays] = await Promise.all([
    fetchSparkStatus(database),
    query<{ n: number }>("SELECT COUNT(*) AS n FROM speed_alerts"),
    query<SpeedMinute>(
      `SELECT minute, hits, client_errors AS clientErrors, server_errors AS serverErrors
       FROM speed_minute ORDER BY minute DESC LIMIT ${SPEED_MINUTES}`,
    ),
    query<SpeedAlert>(
      `SELECT minute, kind, subject, value, threshold
       FROM speed_alerts ORDER BY minute DESC, detected_at DESC LIMIT ${SPEED_ALERTS}`,
    ),
    query<Totals & { day: string }>(
      `SELECT day, SUM(hits) AS hits, SUM(client_errors) AS clientErrors, SUM(server_errors) AS serverErrors
       FROM speed_minute GROUP BY day ORDER BY day`,
    ),
    // The batch layer's table does not exist before the first Sqoop export.
    query<Totals & { day: string }>(
      "SELECT day, hits, client_errors AS clientErrors, server_errors AS serverErrors FROM hits_per_day ORDER BY day",
    ).catch(() => []),
  ]);

  const totals = ({ hits, clientErrors, serverErrors }: Totals): Totals => ({ hits, clientErrors, serverErrors });
  const speedByDay = new Map(speedDays.map((d) => [d.day, totals(d)]));
  const batchByDay = new Map(batchDays.map((d) => [d.day, totals(d)]));
  const days = [...new Set([...speedByDay.keys(), ...batchByDay.keys()])].sort().map((day): SpeedDay => {
    const speed = speedByDay.get(day) ?? { hits: 0, clientErrors: 0, serverErrors: 0 };
    const batch = batchByDay.get(day) ?? null;
    const match =
      batch === null
        ? batchDays.length > 0 ? false : null
        : speed.hits === batch.hits && speed.clientErrors === batch.clientErrors && speed.serverErrors === batch.serverErrors;
    return { day, speed, batch, match };
  });
  return {
    takenAt: Date.now(),
    status,
    alertCount: Number(alertCount[0]?.n ?? 0),
    minutes: latest.reverse(),
    alerts,
    days,
    batchRun: batchDays.length > 0,
  };
}

/** Alert summary per kind, top flooding hosts and the day-by-day comparison, aggregated in SQL. */
export async function fetchSpeedAnalytics(database: string): Promise<SpeedAnalytics> {
  const query = async <T,>(sql: string): Promise<T[]> => {
    const [rows] = await getPool(database).query<RowDataPacket[]>(sql);
    return rows as T[];
  };
  const [counts, worst, floodHosts, snapshot] = await Promise.all([
    query<{ kind: AlertSummary["kind"]; flagged: number; threshold: number }>(
      "SELECT kind, COUNT(*) AS flagged, MIN(threshold) AS threshold FROM speed_alerts GROUP BY kind",
    ),
    // Rows holding the highest value of their kind; ties are resolved below, earliest minute first.
    query<{ kind: AlertSummary["kind"]; minute: string; subject: string; value: number }>(
      `SELECT a.kind, a.minute, a.subject, a.value
       FROM speed_alerts a
       JOIN (SELECT kind, MAX(value) AS top FROM speed_alerts GROUP BY kind) m
         ON m.kind = a.kind AND m.top = a.value
       ORDER BY a.minute, a.subject`,
    ),
    query<FloodHost>(
      `SELECT subject AS host, COUNT(*) AS flaggedMinutes, MAX(value) AS maxRequests
       FROM speed_alerts WHERE kind = 'host_flood'
       GROUP BY subject ORDER BY flaggedMinutes DESC, maxRequests DESC, host LIMIT 10`,
    ),
    fetchSpeed(database),
  ]);
  const alerts = counts.flatMap((c): AlertSummary[] => {
    const top = worst.find((w) => w.kind === c.kind);
    if (!top) return [];
    return [{
      kind: c.kind,
      flagged: Number(c.flagged),
      threshold: Number(c.threshold),
      worstValue: Number(top.value),
      worstMinute: top.minute,
      worstSubject: top.subject,
    }];
  });
  return { alerts, floodHosts, days: snapshot.days, batchRun: snapshot.batchRun };
}
