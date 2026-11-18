import { config } from "@/lib/config";

const roots = {
  flume: "/data/nasa/raw/flume",
  kafka: "/data/nasa/streaming/kafka",
  sqoop: "/data/nasa/reference/sqoop/status_codes",
} as const;

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const zone = query.get("zone") ?? "flume";
  if (!(zone in roots)) return Response.json({error: "Unknown zone"}, {status: 400});
  const root = roots[zone as keyof typeof roots];
  const path = query.get("path") ?? root;
  if ((path !== root && !path.startsWith(root + "/")) || path.split("/").some(p => p === ".." || p === ".") || !/^[a-zA-Z0-9_./=\-]+$/.test(path)) {
    return Response.json({error: "Invalid path"}, {status: 400});
  }
  const preview = query.get("preview") === "1";
  const url = `${config.hdfs.url}/webhdfs/v1${path}?user.name=hadoop&op=${preview ? "OPEN&length=16384" : "LISTSTATUS"}`;
  try {
    const response = await fetch(url, {cache: "no-store", signal: AbortSignal.timeout(5000)});
    if (!response.ok) throw new Error(`HDFS returned ${response.status}`);
    return Response.json(preview
      ? {path, observed_at: Date.now(), text: (await response.text()).split("\n").slice(0, 50).join("\n"), limit: "16 KiB / 50 lines"}
      : {path, observed_at: Date.now(), files: (await response.json()).FileStatuses.FileStatus.slice(0, 200), limit: "200 entries"});
  } catch {
    return Response.json({error: "HDFS unavailable or path unreadable"}, {status: 503});
  }
}
