import "server-only";
import { config } from "@/lib/config";
import { getJson } from "@/lib/sources/http";
import type { HdfsStatus } from "@/lib/types";

interface FileStatus {
  pathSuffix: string;
  type: "FILE" | "DIRECTORY";
  length: number;
}

interface ContentSummary {
  ContentSummary: { length: number; fileCount: number; directoryCount: number };
}

const webhdfs = (path: string, op: string) =>
  `${config.hdfs.url}/webhdfs/v1${path}?op=${op}&user.name=hadoop`;

async function listStatus(path: string): Promise<FileStatus[]> {
  const body = await getJson<{ FileStatuses: { FileStatus: FileStatus[] } }>(
    webhdfs(path, "LISTSTATUS"),
  );
  return body.FileStatuses.FileStatus;
}

/** Day partitions written by Kafka HDFS writer, with their size and the files still open. */
export async function fetchHdfsStatus(): Promise<HdfsStatus> {
  const root = config.hdfs.weblogsPath;
  const [partitions, summary] = await Promise.all([
    listStatus(root),
    getJson<ContentSummary>(webhdfs(root, "GETCONTENTSUMMARY")),
  ]);
  const days = partitions.filter((p) => p.type === "DIRECTORY" && p.pathSuffix.startsWith("dt="));
  // Flume prefixes files it is still writing with "_"; only the newest partitions can hold them.
  const newest = days.map((d) => d.pathSuffix).sort().slice(-2);
  const openFiles = (
    await Promise.all(newest.map((day) => listStatus(`${root}/${day}`)))
  ).flat().filter((file) => file.pathSuffix.startsWith("_")).length;

  return {
    state: openFiles > 0 ? "active" : "idle",
    partitions: days.length,
    files: summary.ContentSummary.fileCount,
    bytes: summary.ContentSummary.length,
    openFiles,
  };
}
