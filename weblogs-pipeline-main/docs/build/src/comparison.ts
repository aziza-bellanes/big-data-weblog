import type { Report } from "./data.ts";
import { esc, int } from "./format.ts";

export function comparisonTable(r: Report): string {
  const a = r.comparison.architectures.sequential;
  const b = r.comparison.architectures.parallel;
  const rows = [
    ["Source lines", int(a.ingestion.lines), int(b.ingestion.lines)],
    ["Every line in HDFS (s)", a.ingestion.allWrittenSeconds, b.ingestion.allWrittenSeconds],
    ["Every raw file closed (s)", a.ingestion.allClosedSeconds, b.ingestion.allClosedSeconds],
    ["Lines per second", int(a.ingestion.linesPerSecond), int(b.ingestion.linesPerSecond)],
    ["Peak Kafka lag", int(a.ingestion.peakKafkaLag), int(b.ingestion.peakKafkaLag)],
    ["Raw HDFS files", a.ingestion.raw.files, b.ingestion.raw.files],
    ["Batch part (s)", a.batchSeconds, b.batchSeconds],
  ];
  return `<table class="data"><tr><th>Measurement</th><th>A · Sequential</th><th>B · Parallel</th></tr>
    ${rows.map((row) => `<tr>${row.map((v) => `<td>${esc(String(v))}</td>`).join("")}</tr>`).join("")}</table>
    <p class="small">Record ${esc(r.comparison.id)}. Six result tables: identical row counts and SHA-256 fingerprints.</p>`;
}

export function comparisonChart(r: Report): string {
  const rows = ["sequential", "parallel"] as const;
  const maximum = Math.max(...rows.map((a) => r.comparison.architectures[a].ingestion.allWrittenSeconds));
  return `<svg viewBox="0 0 720 125" role="img" aria-label="Seconds until every line reaches HDFS; lower is faster">
    ${rows.map((a, i) => {
      const value = r.comparison.architectures[a].ingestion.allWrittenSeconds;
      return `<text x="0" y="${30 + i * 48}" fill="#0b3a56" font-size="15">${i ? "B · Parallel" : "A · Sequential"}</text>
        <rect x="140" y="${12 + i * 48}" width="${450 * value / maximum}" height="26" rx="3" fill="${i ? "#8fb8b0" : "#0b3a56"}"/>
        <text x="${150 + 450 * value / maximum}" y="${31 + i * 48}" fill="#0b3a56" font-size="14">${value} s</text>`;
    }).join("")}</svg>`;
}
