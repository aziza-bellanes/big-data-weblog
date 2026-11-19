"use client";

import { useEffect, useState } from "react";
import { ChevronRight, File, Folder, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatBytes } from "@/lib/format";

type Zone = "raw" | "events" | "speed" | "reference" | "results";

const ZONES: { id: Zone; label: string; about: string }[] = [
  { id: "raw", label: "Raw", about: "Raw log lines written by Flume, one dt=YYYY-MM-DD folder per day." },
  { id: "events", label: "Events", about: "JSON events written by the Kafka HDFS writer." },
  { id: "speed", label: "Speed layer", about: "Per-minute Parquet figures written by Spark Streaming from Kafka." },
  { id: "reference", label: "Reference", about: "The status_codes table imported from MySQL by Sqoop." },
  { id: "results", label: "Results", about: "The six Hive result tables." },
];

interface Entry {
  name: string;
  type: "directory" | "file";
  bytes: number;
  modifiedAt: number;
}

interface Payload {
  root: string;
  path: string;
  observedAt: number;
  files?: Entry[];
  text?: string;
  limit?: string;
  error?: string;
}

interface Nav {
  zone: Zone;
  /** Absolute HDFS path; null means the zone root. */
  path: string | null;
  preview: boolean;
}

const requestKey = (n: Nav) => `${n.zone}|${n.path ?? ""}|${n.preview}`;

const timeFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "medium" });

function sortEntries(files: Entry[]): Entry[] {
  return [...files].sort((a, b) =>
    a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1,
  );
}

/** Browse the HDFS zones, read-only. */
export function ExplorerBrowser() {
  const [nav, setNav] = useState<Nav | null>(null);
  const [result, setResult] = useState<{ key: string; data: Payload } | null>(null);

  const current: Nav = nav ?? { zone: "raw", path: null, preview: false };
  const key = requestKey(current);

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ zone: current.zone });
    if (current.path) query.set("path", current.path);
    if (current.preview) query.set("preview", "1");
    fetch(`/api/explorer?${query}`, { signal: controller.signal, cache: "no-store" })
      .then((response) => response.json() as Promise<Payload>)
      .then((data) => setResult({ key, data }))
      .catch((error: unknown) => {
        if ((error as Error).name === "AbortError") return;
        setResult({ key, data: { root: "", path: "", observedAt: Date.now(), error: "The explorer could not be reached" } });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const zone = ZONES.find((z) => z.id === current.zone) ?? ZONES[0];
  const data = result && result.key === key ? result.data : null;
  const go = (patch: Partial<Nav>) => setNav({ ...current, ...patch });

  const root = data?.root ?? "";
  const relative = data && data.path.startsWith(root) ? data.path.slice(root.length).split("/").filter(Boolean) : [];
  const crumbs = relative.map((name, i) => ({ name, path: `${root}/${relative.slice(0, i + 1).join("/")}` }));
  // The previewed file's folder is one level up.
  const folderOf = (path: string) => path.slice(0, path.lastIndexOf("/"));

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={current.zone} onValueChange={(v) => go({ zone: v as Zone, path: null, preview: false })}>
          <TabsList>
            {ZONES.map((z) => (
              <TabsTrigger key={z.id} value={z.id}>
                {z.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="eyebrow text-primary">{zone.label} zone</CardTitle>
          <CardDescription>{zone.about}</CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          <nav aria-label="Path" className="flex min-w-0 flex-wrap items-center gap-1 font-mono text-xs">
            <button
              type="button"
              className="max-w-full rounded px-1.5 py-0.5 break-all text-primary hover:bg-secondary"
              onClick={() => go({ path: null, preview: false })}
              title={root || zone.label}
            >
              {root || `${zone.id} root`}
            </button>
            {crumbs.map((crumb, i) => (
              <span key={crumb.path} className="flex min-w-0 items-center gap-1">
                <ChevronRight className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                {i === crumbs.length - 1 ? (
                  <span className="break-all px-1.5 py-0.5">{crumb.name}</span>
                ) : (
                  <button
                    type="button"
                    className="rounded px-1.5 py-0.5 break-all text-primary hover:bg-secondary"
                    onClick={() => go({ path: crumb.path, preview: false })}
                  >
                    {crumb.name}
                  </button>
                )}
              </span>
            ))}
          </nav>

          {!data && (
            <div className="space-y-2" aria-busy>
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          )}

          {data?.error && (
            <div role="alert" className="flex items-start gap-3 rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <p className="min-w-0 break-words">{data.error}</p>
            </div>
          )}

          {data && !data.error && data.files && (
            <>
              {data.files.length === 0 ? (
                <p className="rounded-lg bg-muted/50 p-6 text-center text-sm text-muted-foreground">
                  This folder is empty.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead className="text-right">Size</TableHead>
                        <TableHead>Modified</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortEntries(data.files).map((file) => {
                        const isDir = file.type === "directory";
                        const Icon = isDir ? Folder : File;
                        return (
                          <TableRow key={file.name}>
                            <TableCell className="max-w-0 w-full min-w-48">
                              <button
                                type="button"
                                className="flex w-full min-w-0 items-center gap-2 text-left hover:text-primary"
                                onClick={() => go({ path: `${data.path}/${file.name}`, preview: !isDir })}
                              >
                                <Icon className={isDir ? "size-4 shrink-0 text-primary" : "size-4 shrink-0 text-muted-foreground"} aria-hidden />
                                <span className="truncate font-mono text-xs" title={file.name}>
                                  {file.name}
                                </span>
                                {file.name.startsWith("_") && (
                                  <Badge variant="outline" className="text-muted-foreground">
                                    being written
                                  </Badge>
                                )}
                              </button>
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs whitespace-nowrap tabular-nums">
                              {isDir ? "—" : formatBytes(file.bytes)}
                            </TableCell>
                            <TableCell className="font-mono text-xs whitespace-nowrap text-muted-foreground">
                              {timeFormat.format(file.modifiedAt)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
          )}

          {data && !data.error && data.text !== undefined && (
            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 font-mono text-xs break-all text-muted-foreground">{data.path}</p>
                <Button variant="outline" size="sm" onClick={() => go({ path: folderOf(data.path), preview: false })}>
                  Back to folder
                </Button>
              </div>
              <div className="max-h-[30rem] overflow-auto rounded-xl bg-console px-4 py-3 text-console-foreground ring-1 ring-foreground/10">
                {data.text === "" ? (
                  <p className="font-mono text-[0.72rem] text-console-foreground/60">This file is empty.</p>
                ) : (
                  <pre className="w-max min-w-full font-mono text-[0.72rem] leading-relaxed">{data.text}</pre>
                )}
              </div>
            </div>
          )}

          {data && !data.error && (
            <p className="text-xs text-muted-foreground">
              Observed at {timeFormat.format(data.observedAt)} · {data.limit}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
