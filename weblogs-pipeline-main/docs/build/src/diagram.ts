// Architecture and sequence diagrams as inline SVG, shared by the report, the slides, the guide
// and the README images. Each architecture is described as data; two renderers draw them.
import { COLORS } from "./charts.ts";

export type Arch = "sequential" | "parallel";

// ---- Architecture diagrams -------------------------------------------------------------------

interface Node {
  id: string;
  x: number;
  y: number;
  title: string;
  sub: string;
  fill: string;
  text: string;
  /** Height when taller than the default, e.g. B's HDFS receiving three branches. */
  h?: number;
}

interface Edge {
  from: string;
  to: string;
  label: string;
  dashed?: boolean;
}

interface ArchitectureDiagram {
  label: string;
  height: number;
  lanes: { text: string; y: number }[];
  nodes: Node[];
  edges: Edge[];
}

const W = 140;
const H = 54;
const LIGHT = { fill: COLORS.grid, text: COLORS.ink };
const SAGE = { fill: COLORS.sage, text: COLORS.ink };
const NAVY = { fill: COLORS.navy, text: "#fff" };

const DIAGRAMS: Record<Arch, ArchitectureDiagram> = {
  // A · Sequential: one chain, ingestion left to right, batch back right to left.
  sequential: {
    label: "Architecture A, sequential",
    height: 220,
    lanes: [
      { text: "NEAR-REAL-TIME INGESTION", y: 16 },
      { text: "BATCH ANALYSIS AND REPORTING", y: 136 },
    ],
    nodes: [
      { id: "logs", x: 10, y: 30, title: "NASA logs", sub: "replayer → access.log", ...LIGHT },
      { id: "f1", x: 236, y: 30, title: "Flume agent 1", sub: "TAILDIR → Kafka sink", ...SAGE },
      { id: "kafka", x: 462, y: 30, title: "Kafka", sub: "topic web-logs ×3", ...NAVY },
      { id: "f2", x: 688, y: 30, title: "Flume agent 2", sub: "Kafka source → HDFS", ...SAGE },
      { id: "hdfs", x: 688, y: 150, title: "HDFS", sub: "/data/weblogs/dt=…", ...NAVY },
      { id: "hive", x: 462, y: 150, title: "Hive", sub: "RegexSerDe + HiveQL", ...NAVY },
      { id: "sqoop", x: 236, y: 150, title: "Sqoop", sub: "MySQL ↔ HDFS", ...SAGE },
      { id: "mysql", x: 10, y: 150, title: "MySQL", sub: "results + status_codes", ...LIGHT },
    ],
    edges: [
      { from: "logs", to: "f1", label: "tail" },
      { from: "f1", to: "kafka", label: "publish" },
      { from: "kafka", to: "f2", label: "consume" },
      { from: "f2", to: "hdfs", label: "write by day" },
      { from: "hdfs", to: "hive", label: "read" },
      { from: "hive", to: "sqoop", label: "result files" },
      { from: "sqoop", to: "mysql", label: "export" },
      { from: "mysql", to: "sqoop", label: "import", dashed: true },
      { from: "sqoop", to: "hive", label: "status_codes", dashed: true },
    ],
  },
  // B · Parallel: three independent branches end in HDFS, then the same batch part.
  parallel: {
    label: "Architecture B, parallel",
    height: 340,
    lanes: [
      { text: "THREE INDEPENDENT INGESTION BRANCHES", y: 16 },
      { text: "BATCH ANALYSIS AND REPORTING", y: 256 },
    ],
    nodes: [
      { id: "logs", x: 10, y: 30, title: "NASA logs", sub: "replayer → access.log", ...LIGHT },
      { id: "flume", x: 236, y: 30, title: "Flume", sub: "TAILDIR → HDFS sink", ...SAGE },
      { id: "producer", x: 10, y: 100, title: "Producer", sub: "NASA files → JSON events", ...LIGHT },
      { id: "kafka", x: 236, y: 100, title: "Kafka", sub: "topic web-events ×3", ...NAVY },
      { id: "writer", x: 462, y: 100, title: "HDFS writer", sub: "closed file, then commit", ...SAGE },
      { id: "ref", x: 10, y: 170, title: "MySQL", sub: "status_codes", ...LIGHT },
      { id: "import", x: 236, y: 170, title: "Sqoop import", sub: "staging → check → swap", ...SAGE },
      { id: "hdfs", x: 688, y: 30, h: 194, title: "HDFS", sub: "/data/nasa/…", ...NAVY },
      { id: "hive", x: 688, y: 270, title: "Hive", sub: "RegexSerDe + HiveQL", ...NAVY },
      { id: "export", x: 462, y: 270, title: "Sqoop export", sub: "HDFS → MySQL", ...SAGE },
      { id: "mysql", x: 236, y: 270, title: "MySQL", sub: "weblogs_parallel", ...LIGHT },
    ],
    edges: [
      { from: "logs", to: "flume", label: "tail" },
      { from: "flume", to: "hdfs", label: "raw lines by day" },
      { from: "producer", to: "kafka", label: "publish, acks=all" },
      { from: "kafka", to: "writer", label: "consume" },
      { from: "writer", to: "hdfs", label: "JSON by day" },
      { from: "ref", to: "import", label: "read", dashed: true },
      { from: "import", to: "hdfs", label: "reference copy", dashed: true },
      { from: "hdfs", to: "hive", label: "read" },
      { from: "hive", to: "export", label: "result files" },
      { from: "export", to: "mysql", label: "export" },
    ],
  },
};

const height = (n: Node) => n.h ?? H;

/**
 * A straight edge: horizontal when the source's middle faces the target (two edges between the
 * same pair are drawn apart, the dashed one below), vertical otherwise.
 */
function edgePath(from: Node, to: Node, pair: boolean, dashed: boolean): { d: string; lx: number; ly: number; side: boolean } {
  const middle = from.y + height(from) / 2;
  if (middle > to.y && middle < to.y + height(to)) {
    const offset = pair ? (dashed ? 7 : -7) : 0;
    const y = middle + offset;
    const leftToRight = to.x > from.x;
    const x1 = leftToRight ? from.x + W : from.x;
    const x2 = leftToRight ? to.x : to.x + W;
    return { d: `M${x1},${y} L${x2},${y}`, lx: (x1 + x2) / 2, ly: dashed && pair ? y + 13 : y - 7, side: false };
  }
  const x = from.x + W / 2;
  const down = to.y > from.y;
  const [y1, y2] = down ? [from.y + height(from), to.y] : [from.y, to.y + height(to)];
  return { d: `M${x},${y1} L${x},${y2}`, lx: x + 8, ly: (y1 + y2) / 2 + 4, side: true };
}

export function architectureSvg(arch: Arch = "sequential"): string {
  const diagram = DIAGRAMS[arch];
  const byId = new Map(diagram.nodes.map((n) => [n.id, n]));
  const paired = (e: Edge) => diagram.edges.some((o) => o.from === e.to && o.to === e.from);
  const edges = diagram.edges.map((edge) => {
    const { d, lx, ly, side } = edgePath(byId.get(edge.from)!, byId.get(edge.to)!, paired(edge), !!edge.dashed);
    return `<path d="${d}" stroke="${COLORS.ink}" stroke-width="1.6" fill="none" marker-end="url(#arrow)"
        ${edge.dashed ? 'stroke-dasharray="5 4"' : ""}/>
      <text x="${lx}" y="${ly}" text-anchor="${side ? "start" : "middle"}" font-size="10" font-family="Poppins" fill="${COLORS.muted}">${edge.label}</text>`;
  }).join("");
  const nodes = diagram.nodes.map((n) => {
    const h = height(n);
    return `<g transform="translate(${n.x},${n.y})">
      <rect width="${W}" height="${h}" rx="8" fill="${n.fill}"/>
      <text x="${W / 2}" y="${h / 2 - 4}" text-anchor="middle" font-size="13" font-family="Archivo Variable" font-weight="800"
        font-stretch="115%" fill="${n.text}">${n.title}</text>
      <text x="${W / 2}" y="${h / 2 + 13}" text-anchor="middle" font-size="9.5" font-family="Poppins" fill="${n.text}" opacity="0.85">${n.sub}</text>
    </g>`;
  }).join("");
  const lanes = diagram.lanes.map(
    (lane) => `<text x="10" y="${lane.y}" font-size="9" letter-spacing="2.5" font-family="Poppins" fill="${COLORS.muted}">${lane.text}</text>`,
  ).join("");
  return `<svg viewBox="0 0 840 ${diagram.height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${diagram.label}" text-rendering="geometricPrecision">
    <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="${COLORS.ink}"/></marker></defs>
    ${lanes}${edges}${nodes}</svg>`;
}

// ---- One log line, step by step ------------------------------------------------------------

interface Lane {
  id: string;
  title: string;
  fill: string;
  text: string;
}

type Step = { from: string; to: string; label: string; dashed?: boolean } | { note: string; from: string; to: string };

interface SequenceDiagram {
  lanes: Lane[];
  steps: Step[];
}

const lane = (id: string, title: string, colors: { fill: string; text: string }): Lane => ({ id, title, ...colors });

const SEQUENCES: Record<Arch, SequenceDiagram> = {
  sequential: {
    lanes: [
      lane("replayer", "Replayer", LIGHT), lane("f1", "Flume 1", SAGE), lane("kafka", "Kafka", NAVY),
      lane("f2", "Flume 2", SAGE), lane("hdfs", "HDFS", NAVY), lane("hive", "Hive", NAVY),
      lane("sqoop", "Sqoop", SAGE), lane("mysql", "MySQL", LIGHT),
    ],
    steps: [
      { from: "replayer", to: "f1", label: "append line" },
      { from: "f1", to: "kafka", label: "publish + time" },
      { from: "kafka", to: "f2", label: "consume" },
      { from: "f2", to: "hdfs", label: "dt=1995-07-01/" },
      { note: "make counts: lines replayed = lines in HDFS", from: "replayer", to: "hdfs" },
      { from: "mysql", to: "sqoop", label: "status_codes", dashed: true },
      { from: "sqoop", to: "hdfs", label: "import to /data/reference/", dashed: true },
      { from: "hdfs", to: "hive", label: "regex + join" },
      { from: "hive", to: "hdfs", label: "/data/results/" },
      { from: "hdfs", to: "sqoop", label: "read result files" },
      { from: "sqoop", to: "mysql", label: "export 6 tables" },
    ],
  },
  parallel: {
    lanes: [
      lane("replayer", "Replayer", LIGHT), lane("flume", "Flume", SAGE), lane("producer", "Producer", LIGHT),
      lane("kafka", "Kafka", NAVY), lane("writer", "Writer", SAGE), lane("hdfs", "HDFS", NAVY),
      lane("hive", "Hive", NAVY), lane("sqoop", "Sqoop", SAGE), lane("mysql", "MySQL", LIGHT),
    ],
    steps: [
      { from: "replayer", to: "flume", label: "append line" },
      { from: "flume", to: "hdfs", label: "raw line, dt=1995-07-01/" },
      { from: "producer", to: "kafka", label: "JSON + event_id" },
      { from: "kafka", to: "producer", label: "acks=all", dashed: true },
      { from: "kafka", to: "writer", label: "consume a batch" },
      { from: "writer", to: "hdfs", label: "file, then commit" },
      { from: "mysql", to: "sqoop", label: "status_codes", dashed: true },
      { from: "sqoop", to: "hdfs", label: "staging → check → swap", dashed: true },
      { note: "make verify-ingestion: lines, event IDs and rows match their sources", from: "replayer", to: "hdfs" },
      { from: "hdfs", to: "hive", label: "regex + join" },
      { from: "hive", to: "hdfs", label: "results/" },
      { from: "hdfs", to: "sqoop", label: "read result files" },
      { from: "sqoop", to: "mysql", label: "export 6 tables" },
    ],
  },
};

export function sequenceSvg(arch: Arch = "sequential"): string {
  const { lanes, steps } = SEQUENCES[arch];
  const width = 1000;
  const margin = 62;
  const gap = (width - 2 * margin) / (lanes.length - 1);
  const x = (id: string) => margin + lanes.findIndex((l) => l.id === id) * gap;
  const boxWidth = Math.min(100, gap - 10);
  const top = 44;
  const row = 40;
  const bottom = top + 22 + steps.length * row;
  const box = (l: Lane, y: number) =>
    `<g transform="translate(${x(l.id) - boxWidth / 2},${y})"><rect width="${boxWidth}" height="32" rx="7" fill="${l.fill}"/>
      <text x="${boxWidth / 2}" y="21" text-anchor="middle" font-size="12.5" font-family="Archivo Variable" font-weight="800"
        font-stretch="115%" fill="${l.text}">${l.title}</text></g>`;

  let n = 0;
  const drawn = steps.map((step, i) => {
    const y = top + 52 + i * row;
    const [a, b] = [x(step.from), x(step.to)];
    if ("note" in step) {
      return `<rect x="${a - 44}" y="${y - 12}" width="${b - a + 88}" height="22" rx="5" fill="${COLORS.sage}" opacity="0.35"/>
        <text x="${(a + b) / 2}" y="${y + 3}" text-anchor="middle" font-size="10.5" font-family="Poppins" fill="${COLORS.ink}">${step.note}</text>`;
    }
    n += 1;
    const dir = b > a ? 1 : -1;
    return `<path d="M${a + dir * 9},${y} L${b - dir * 2},${y}" stroke="${COLORS.ink}" stroke-width="1.5" fill="none"
        marker-end="url(#seq-arrow)" ${step.dashed ? 'stroke-dasharray="5 4"' : ""}/>
      <circle cx="${a}" cy="${y}" r="8" fill="${COLORS.ink}"/>
      <text x="${a}" y="${y + 3.5}" text-anchor="middle" font-size="9" font-weight="600" font-family="Poppins" fill="#fff">${n}</text>
      <text x="${(a + b) / 2}" y="${y - 8}" text-anchor="middle" font-size="10.5" font-family="Poppins" fill="${COLORS.ink}">${step.label}</text>`;
  }).join("");

  const lifelines = lanes.map(
    (l) => `<line x1="${x(l.id)}" y1="${top + 32}" x2="${x(l.id)}" y2="${bottom}" stroke="${COLORS.muted}" stroke-width="1" stroke-dasharray="2 4"/>`,
  ).join("");
  return `<svg viewBox="0 0 ${width} ${bottom + 8}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="One log line through architecture ${arch === "parallel" ? "B" : "A"}" text-rendering="geometricPrecision">
    <defs><marker id="seq-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="${COLORS.ink}"/></marker></defs>
    <text x="${margin - 50}" y="16" font-size="9" letter-spacing="2.5" font-family="Poppins" fill="${COLORS.muted}">ONE LOG LINE, STEP BY STEP</text>
    ${lifelines}${lanes.map((l) => box(l, top)).join("")}${drawn}</svg>`;
}
