// Everything the report and slides quote, read from the running stack so the figures always
// match the last pipeline run. Requires `make up` and a completed `make pipeline`.
import mysql, { type RowDataPacket } from "mysql2/promise";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export interface Meta {
  title: string;
  subtitle: string;
  authors: string[];
  course: string;
  teacher: string;
  institution: string;
  date: string;
}

export interface Report {
  meta: Meta;
  topPages: { path: string; hits: number }[];
  hourly: { hour: number; hits: number; avgPerDay: number }[];
  daily: { day: string; hits: number; clientErrors: number; serverErrors: number; uniqueHosts: number }[];
  statuses: { status: number; label: string; category: string; hits: number; pct: number }[];
  topHosts: { host: string; hits: number }[];
  quality: { total: number; parsed: number; malformed: number; malformedPct: number };
  hdfs: { partitions: number; bytes: number; files: number };
}

const DOCS_DIR = fileURLToPath(new URL("../../", import.meta.url));

const MYSQL = {
  host: process.env.MYSQL_HOST ?? "127.0.0.1",
  port: Number(process.env.MYSQL_HOST_PORT ?? 3307),
  user: "sqoop",
  password: "sqoop",
  database: "weblogs",
  decimalNumbers: true,
  supportBigNumbers: true,
  dateStrings: true,
};

const HDFS_URL = process.env.HDFS_HTTP_URL ?? "http://127.0.0.1:9870";

async function loadHdfs(): Promise<Report["hdfs"]> {
  const op = (name: string) => `${HDFS_URL}/webhdfs/v1/data/nasa/raw/flume?op=${name}&user.name=hadoop`;
  const [list, summary] = await Promise.all([
    fetch(op("LISTSTATUS")).then((r) => r.json()),
    fetch(op("GETCONTENTSUMMARY")).then((r) => r.json()),
  ]);
  const partitions = (list.FileStatuses.FileStatus as { pathSuffix: string }[]).filter((s) =>
    s.pathSuffix.startsWith("dt="),
  ).length;
  return { partitions, bytes: summary.ContentSummary.length, files: summary.ContentSummary.fileCount };
}

export async function loadReport(): Promise<Report> {
  const meta = JSON.parse(await readFile(`${DOCS_DIR}meta.json`, "utf8")) as Meta;
  const db = await mysql.createConnection(MYSQL);
  const rows = async <T>(sql: string) => (await db.query<RowDataPacket[]>(sql))[0] as T[];
  try {
    const [topPages, hourly, daily, statuses, topHosts, quality, hdfs] = await Promise.all([
      rows<Report["topPages"][number]>("SELECT path, hits FROM top_pages ORDER BY hits DESC"),
      rows<Report["hourly"][number]>(
        "SELECT hour_of_day AS hour, hits, avg_hits_per_day AS avgPerDay FROM hits_per_hour ORDER BY hour_of_day",
      ),
      rows<Report["daily"][number]>(
        `SELECT day, hits, client_errors AS clientErrors, server_errors AS serverErrors,
                unique_hosts AS uniqueHosts FROM hits_per_day ORDER BY day`,
      ),
      rows<Report["statuses"][number]>(
        "SELECT status, label, category, hits, pct FROM status_distribution ORDER BY hits DESC",
      ),
      rows<Report["topHosts"][number]>("SELECT host, hits FROM top_hosts ORDER BY hits DESC"),
      rows<Report["quality"]>(
        `SELECT total_lines AS total, parsed_lines AS parsed, malformed_lines AS malformed,
                malformed_pct AS malformedPct FROM data_quality LIMIT 1`,
      ),
      loadHdfs(),
    ]);
    if (!quality[0]) throw new Error("data_quality is empty: run `make pipeline` first");
    return { meta, topPages, hourly, daily, statuses, topHosts, quality: quality[0], hdfs };
  } finally {
    await db.end();
  }
}
