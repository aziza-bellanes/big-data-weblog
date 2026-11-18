// Dependency-free SVG charts in the template palette, sized by their container (viewBox).
import { day, esc, hour, int } from "./format.ts";

export const COLORS = {
  navy: "#0B4A6F",
  sage: "#8FB8B0",
  amber: "#D99A2B",
  red: "#C2412D",
  ink: "#173B57",
  grid: "#DCD5CB",
  muted: "#6B7F8E",
} as const;

const FONT = `font-family="Poppins" fill="${COLORS.muted}"`;

/** Round an axis maximum up to 1, 2 or 5 times a power of ten. */
function niceMax(value: number): number {
  const power = 10 ** Math.floor(Math.log10(Math.max(value, 1)));
  return [1, 2, 5, 10].map((m) => m * power).find((m) => m >= value) ?? value;
}

const compact = (v: number) =>
  v >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${+(v / 1e3).toFixed(0)}k` : String(v);

interface Frame {
  width: number;
  height: number;
  left: number;
  bottom: number;
  top: number;
  right: number;
}

function yAxis(f: Frame, max: number, ticks = 4): string {
  const plotH = f.height - f.top - f.bottom;
  return Array.from({ length: ticks + 1 }, (_, i) => {
    const value = (max / ticks) * i;
    const y = f.top + plotH - (value / max) * plotH;
    return `<line x1="${f.left}" x2="${f.width - f.right}" y1="${y}" y2="${y}" stroke="${COLORS.grid}" stroke-width="1"/>
      <text x="${f.left - 8}" y="${y + 4}" text-anchor="end" font-size="11" ${FONT}>${compact(value)}</text>`;
  }).join("");
}

/** Vertical bars, one per item. */
export function barChart(
  items: { label: string; value: number }[],
  opts: { width?: number; height?: number; labelEvery?: number; color?: string } = {},
): string {
  const f: Frame = { width: opts.width ?? 720, height: opts.height ?? 260, left: 48, right: 8, top: 12, bottom: 28 };
  const max = niceMax(Math.max(...items.map((i) => i.value)));
  const plotW = f.width - f.left - f.right;
  const plotH = f.height - f.top - f.bottom;
  const slot = plotW / items.length;
  const bars = items
    .map((item, i) => {
      const h = (item.value / max) * plotH;
      const x = f.left + i * slot + slot * 0.15;
      const label =
        i % (opts.labelEvery ?? 1) === 0
          ? `<text x="${x + slot * 0.35}" y="${f.height - 8}" text-anchor="middle" font-size="11" ${FONT}>${esc(item.label)}</text>`
          : "";
      return `<rect x="${x}" y="${f.top + plotH - h}" width="${slot * 0.7}" height="${h}" rx="3" fill="${opts.color ?? COLORS.navy}"/>${label}`;
    })
    .join("");
  return `<svg viewBox="0 0 ${f.width} ${f.height}" xmlns="http://www.w3.org/2000/svg" role="img">${yAxis(f, max)}${bars}</svg>`;
}

/** Hits per hour of day (average per day). */
export const hourlyChart = (data: { hour: number; avgPerDay: number }[], size?: { width?: number; height?: number }) =>
  barChart(data.map((d) => ({ label: hour(d.hour), value: d.avgPerDay })), { ...size, labelEvery: 3 });

/** Filled area of requests per day, with distinct hosts as a second line. */
export function dailyChart(
  data: { day: string; hits: number; uniqueHosts: number }[],
  size: { width?: number; height?: number } = {},
): string {
  const f: Frame = { width: size.width ?? 720, height: size.height ?? 260, left: 48, right: 8, top: 12, bottom: 28 };
  const max = niceMax(Math.max(...data.map((d) => d.hits)));
  const plotW = f.width - f.left - f.right;
  const plotH = f.height - f.top - f.bottom;
  const x = (i: number) => f.left + (i / Math.max(1, data.length - 1)) * plotW;
  const y = (v: number) => f.top + plotH - (v / max) * plotH;
  const line = (key: "hits" | "uniqueHosts") => data.map((d, i) => `${i ? "L" : "M"}${x(i)},${y(d[key])}`).join(" ");
  const area = `${line("hits")} L${x(data.length - 1)},${f.top + plotH} L${x(0)},${f.top + plotH} Z`;
  const labels = data
    .map((d, i) =>
      i % 7 === 0
        ? `<text x="${x(i)}" y="${f.height - 8}" text-anchor="middle" font-size="11" ${FONT}>${day(d.day)}</text>`
        : "",
    )
    .join("");
  return `<svg viewBox="0 0 ${f.width} ${f.height}" xmlns="http://www.w3.org/2000/svg" role="img">
    <defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="${COLORS.navy}" stop-opacity="0.35"/><stop offset="1" stop-color="${COLORS.navy}" stop-opacity="0.03"/>
    </linearGradient></defs>
    ${yAxis(f, max)}
    <path d="${area}" fill="url(#g)"/>
    <path d="${line("hits")}" fill="none" stroke="${COLORS.navy}" stroke-width="2"/>
    <path d="${line("uniqueHosts")}" fill="none" stroke="${COLORS.sage}" stroke-width="2"/>
    ${labels}</svg>`;
}

/** Donut of request shares per status family, with a legend. */
export function statusDonut(statuses: { status: number; hits: number }[], size = 240): string {
  const families = [
    { name: "Success (2xx)", color: COLORS.navy, test: (s: number) => s < 300 },
    { name: "Redirection (3xx)", color: COLORS.sage, test: (s: number) => s >= 300 && s < 400 },
    { name: "Client error (4xx)", color: COLORS.amber, test: (s: number) => s >= 400 && s < 500 },
    { name: "Server error (5xx)", color: COLORS.red, test: (s: number) => s >= 500 },
  ].map((f) => ({ ...f, hits: statuses.filter((s) => f.test(s.status)).reduce((a, s) => a + s.hits, 0) }));
  const total = families.reduce((a, f) => a + f.hits, 0);
  const r = size / 2 - 10;
  const c = size / 2;
  const circumference = 2 * Math.PI * (r - 18);
  let offset = 0;
  const rings = families
    .map((f) => {
      const length = (f.hits / total) * circumference;
      const ring = `<circle cx="${c}" cy="${c}" r="${r - 18}" fill="none" stroke="${f.color}" stroke-width="36"
        stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${c} ${c})"/>`;
      offset += length;
      return ring;
    })
    .join("");
  const legend = families
    .map(
      (f, i) => `<g transform="translate(${size + 24}, ${40 + i * 40})">
        <rect width="14" height="14" rx="3" fill="${f.color}"/>
        <text x="24" y="12" font-size="14" font-family="Poppins" fill="${COLORS.ink}">${f.name}</text>
        <text x="24" y="30" font-size="12" ${FONT}>${int(f.hits)} · ${((f.hits / total) * 100).toFixed(2)}%</text>
      </g>`,
    )
    .join("");
  return `<svg viewBox="0 0 ${size + 250} ${size}" xmlns="http://www.w3.org/2000/svg" role="img">${rings}
    <text x="${c}" y="${c}" text-anchor="middle" font-size="22" font-family="Archivo" font-weight="800" fill="${COLORS.ink}">${compact(total)}</text>
    <text x="${c}" y="${c + 20}" text-anchor="middle" font-size="12" ${FONT}>requests</text>${legend}</svg>`;
}
