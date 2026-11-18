"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";

interface Listing {
  path: string;
  observed_at: number;
  files?: {pathSuffix: string; type: string; length: number}[];
  text?: string;
  error?: string;
  limit?: string;
}

export default function Explorer() {
  const [zone, setZone] = useState("flume");
  const [result, setResult] = useState<Listing | null>(null);
  const [busy, setBusy] = useState(false);
  async function browse(nextZone: string, path?: string, preview = false) {
    setZone(nextZone);
    setBusy(true);
    try {
      const query = new URLSearchParams({zone: nextZone, preview: preview ? "1" : "0"});
      if (path) query.set("path", path);
      const response = await fetch(`/api/explorer?${query}`);
      setResult(await response.json());
    } catch {
      setResult({path: "", observed_at: 0, error: "Explorer unavailable"});
    } finally { setBusy(false); }
  }
  return <main className="space-y-5 p-6">
    <h1 className="text-2xl font-semibold">HDFS Data Explorer</h1>
    <p>Flume raw logs are canonical. Kafka holds the same requests as JSON. Sqoop holds reference data.</p>
    <div className="flex gap-3">{["flume", "kafka", "sqoop"].map(name =>
      <Button key={name} disabled={busy} variant="outline" onClick={() => browse(name)}>{name}</Button>)}</div>
    {result?.error && <p role="alert">{result.error}</p>}
    {result && !result.error && <>
      <p className="font-mono text-sm">{result.path}</p>
      <p className="text-xs">Observed {new Date(result.observed_at).toLocaleString()} · {result.limit}</p>
      {result.files?.map(file => <div key={file.pathSuffix} className="flex items-center gap-4">
        <Button variant="ghost" disabled={busy} onClick={() => browse(zone, result.path + "/" + file.pathSuffix, file.type === "FILE")}>{file.pathSuffix}</Button>
        <span>{file.type} · {file.length} bytes</span>
      </div>)}
      {result.text !== undefined && <pre className="overflow-auto rounded border p-4 text-xs">{result.text}</pre>}
    </>}
  </main>;
}
