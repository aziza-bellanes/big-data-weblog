import { connection } from "next/server";
import { isArchName } from "@/lib/arch";
import { getArchitecture } from "@/lib/architectures";
import { config } from "@/lib/config";
import type { ArchName } from "@/lib/types";

const PREVIEW_BYTES = 16384;
const PREVIEW_LINES = 50;
const MAX_ENTRIES = 200;
const SAFE_PATH = /^[a-zA-Z0-9_./=\-]+$/;

/** HDFS folders the explorer may show: the ingestion zones and results of one architecture. */
function zones(arch: ArchName): Record<string, string> {
  const a = getArchitecture(arch);
  const entries: [string, string | null][] = [
    ["raw", a.rawDir], ["events", a.eventsDir], ["reference", a.referenceDir], ["results", a.resultsRoot],
  ];
  return Object.fromEntries(entries.filter((entry): entry is [string, string] => entry[1] !== null));
}

/**
 * List a folder or preview the start of a file, inside one zone only. Read-only: WebHDFS
 * LISTSTATUS (first 200 entries) or OPEN (first 16 KiB, 50 lines).
 */
export async function GET(request: Request) {
  await connection();
  const query = new URL(request.url).searchParams;
  const arch = query.get("arch");
  if (!isArchName(arch)) return Response.json({ error: "Unknown architecture" }, { status: 400 });
  const roots = zones(arch);
  const zone = query.get("zone") ?? "raw";
  const root = roots[zone];
  if (!root) return Response.json({ error: "Unknown zone" }, { status: 400 });
  const path = query.get("path") ?? root;
  const inside = path === root || path.startsWith(`${root}/`);
  if (!inside || !SAFE_PATH.test(path) || path.split("/").some((part) => part === ".." || part === ".")) {
    return Response.json({ error: "Invalid path" }, { status: 400 });
  }
  const preview = query.get("preview") === "1";
  const op = preview ? `OPEN&length=${PREVIEW_BYTES}` : "LISTSTATUS";
  try {
    const response = await fetch(`${config.hdfsUrl}/webhdfs/v1${path}?user.name=hadoop&op=${op}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`HDFS returned ${response.status}`);
    if (preview) {
      const text = (await response.text()).split("\n").slice(0, PREVIEW_LINES).join("\n");
      return Response.json({ arch, zone, root, path, observedAt: Date.now(), text, limit: `first ${PREVIEW_LINES} lines` });
    }
    const listing = (await response.json()) as { FileStatuses: { FileStatus: { pathSuffix: string; type: string; length: number; modificationTime: number }[] } };
    const files = listing.FileStatuses.FileStatus.slice(0, MAX_ENTRIES).map((f) => ({
      name: f.pathSuffix, type: f.type === "DIRECTORY" ? "directory" : "file", bytes: f.length, modifiedAt: f.modificationTime,
    }));
    return Response.json({ arch, zone, root, path, observedAt: Date.now(), files, limit: `first ${MAX_ENTRIES} entries` });
  } catch {
    return Response.json({ error: "HDFS is unavailable or the path cannot be read" }, { status: 503 });
  }
}
