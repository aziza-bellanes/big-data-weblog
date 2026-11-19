// Screenshots used by the report, slides and guides: dashboard pages, the native HDFS and YARN
// web UIs, and real command output rendered as a terminal window.
// Usage: tsx src/capture.ts [shot ...]   (no argument = every shot)
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { chromium, type Page } from "playwright";
import { esc } from "./format.ts";
import { DOCS_DIR, FONT_FACES } from "./layout.ts";

const run = promisify(execFile);
const OUT = `${DOCS_DIR}assets/screenshots/`;
const REPO = `${DOCS_DIR}../`;
const DASHBOARD = process.env.DASHBOARD_URL ?? "http://localhost:3030";
const HDFS = process.env.HDFS_HTTP_URL ?? "http://localhost:9870";
const YARN = process.env.YARN_HTTP_URL ?? "http://localhost:8088";

type Shot = (page: Page) => Promise<void>;
const VIEWPORT = { width: 1440, height: 900 };

interface WebShot {
  captureSelector?: string;
  waitFor?: string;
  settleMs?: number;
  /** Capture the whole page. The viewport is grown instead of using Playwright's fullPage,
   *  so fixed elements such as the sidebar stretch to the full height. */
  fullPage?: boolean;
  /** Capture only the top of the page, in CSS pixels. */
  height?: number;
}

async function webPage(page: Page, url: string, file: string, opts: WebShot = {}) {
  await page.goto(url, { waitUntil: "networkidle" });
  if (opts.waitFor) await page.waitForSelector(opts.waitFor, { timeout: 15_000 });
  await page.waitForTimeout(opts.settleMs ?? 800);
  const viewport = page.viewportSize() ?? VIEWPORT;
  if (opts.fullPage) {
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width: viewport.width, height });
    await page.waitForTimeout(400);
  }
  const clip = opts.height ? { x: 0, y: 0, width: viewport.width, height: opts.height } : undefined;
  if (opts.captureSelector) {
    await page.locator(opts.captureSelector).screenshot({ path: `${OUT}${file}` });
  } else {
    await page.screenshot({ path: `${OUT}${file}`, clip });
  }
  await page.setViewportSize(VIEWPORT);
}

interface TerminalShot {
  /** What the window shows as the typed command. */
  label: string;
  command: string;
  args: string[];
  /** Keep the first lines instead of the last ones (then "..." marks the cut). */
  head?: boolean;
  lines?: number;
}

/** Run a project command and screenshot its output in a terminal-styled window. */
async function terminal(page: Page, file: string, shot: TerminalShot) {
  const { stdout, stderr } = await run(shot.command, shot.args, { cwd: REPO, maxBuffer: 10 * 1024 * 1024 });
  const limit = shot.lines ?? 14;
  const all = `${stdout}${stderr}`.split("\n").filter((line) => !/WARN|SLF4J|Warning|^\s*$/.test(line));
  const output = shot.head
    ? [...all.slice(0, limit), ...(all.length > limit ? ["..."] : [])].join("\n")
    : all.slice(-limit).join("\n");
  const label = shot.label;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${FONT_FACES}
    body { margin: 0; background: transparent; }
    #term { display: inline-block; min-width: 860px; max-width: 1100px; border-radius: 12px; overflow: hidden;
      background: #0f2c40; color: #e5eef3; font: 14px/1.6 "JetBrains Mono Variable", monospace; }
    .chrome { display: flex; gap: 8px; padding: 12px 14px; background: #0b3a56; }
    .chrome span { width: 12px; height: 12px; border-radius: 50%; }
    pre { margin: 0; padding: 16px 20px; white-space: pre-wrap; font: inherit; }
    .prompt { color: #8fb8b0; }
  </style></head><body><div id="term">
    <div class="chrome"><span style="background:#e06c5b"></span><span style="background:#e8b04a"></span><span style="background:#8fb8b0"></span></div>
    <pre><span class="prompt">$ ${esc(label)}</span>\n${esc(output)}</pre></div></body></html>`;
  // Loaded from a file so the bundled fonts (file:// URLs) are allowed.
  const dir = await mkdtemp(`${tmpdir()}/weblogs-terminal-`);
  try {
    await writeFile(`${dir}/terminal.html`, html);
    await page.goto(`file://${dir}/terminal.html`);
    await page.evaluate(() => document.fonts.ready);
    await page.locator("#term").screenshot({ path: `${OUT}${file}`, omitBackground: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const SHOTS: Record<string, Shot> = {
  "dashboard-overview": (p) => webPage(p, `${DASHBOARD}/`, "dashboard-overview.png", { waitFor: "text=Requests per day", settleMs: 2500 }),
  "dashboard-analytics": (p) =>
    webPage(p, `${DASHBOARD}/analytics`, "dashboard-analytics.png", { waitFor: "text=Data quality", fullPage: true, settleMs: 1500 }),
  "dashboard-pipeline": (p) => webPage(p, `${DASHBOARD}/pipeline`, "dashboard-pipeline.png", { waitFor: "text=Data flow", settleMs: 5000 }),
  "dashboard-pipeline-parallel": (p) => webPage(p, `${DASHBOARD}/pipeline`, "dashboard-pipeline-parallel.png", {
    settleMs: 5000,
    captureSelector: '[data-slot="card"]:has([data-slot="card-title"]:text-is("Data flow"))',
  }),
  "dashboard-realtime": (p) => webPage(p, `${DASHBOARD}/realtime`, "dashboard-realtime.png", { settleMs: 4000, fullPage: true }),
  "dashboard-explorer": (p) => webPage(p, `${DASHBOARD}/explorer`, "dashboard-explorer.png", { settleMs: 2500, fullPage: true }),
  "hdfs-raw-zone": (p) =>
    webPage(p, `${HDFS}/explorer.html#/data/nasa/raw/flume`, "hdfs-raw-zone.png", { waitFor: "text=dt=1995-07-01", settleMs: 1200, height: 620 }),
  "yarn-apps": (p) => webPage(p, `${YARN}/cluster/apps`, "yarn-apps.png", { waitFor: "#apps", settleMs: 1200, height: 720 }),
  "dashboard-live-run": captureRun,
  "dashboard-dark": async (p) => {
    await p.emulateMedia({ colorScheme: "dark" });
    await webPage(p, `${DASHBOARD}/`, "dashboard-dark.png", { waitFor: "text=Requests per day", settleMs: 2500 });
    await p.emulateMedia({ colorScheme: "light" });
  },
  "cluster-status": (p) =>
    terminal(p, "cluster-status.png", {
      label: "make status",
      command: "docker",
      args: ["compose", "ps", "-a", "--format", "table {{.Service}}\t{{.Status}}\t{{.Ports}}"],
      head: true,
      lines: 16,
    }),
  "hdfs-zones": (p) =>
    terminal(p, "hdfs-zones.png", { label: "make hdfs-ls", command: "make", args: ["-s", "hdfs-ls"], head: true, lines: 10 }),
  "kafka-events": (p) =>
    terminal(p, "kafka-events.png", { label: "make topic-peek", command: "make", args: ["-s", "topic-peek"] }),
  "no-loss-check": (p) => terminal(p, "no-loss-check.png", { label: "make counts", command: "make", args: ["-s", "counts"] }),
  "verify-ingestion": (p) => terminal(p, "verify-ingestion.png", { label: "make verify-ingestion", command: "make", args: ["-s", "verify-ingestion"], lines: 24 }),
  "terminal-speed": (p) => terminal(p, "terminal-speed.png", { label: "make speed-layer", command: "make", args: ["-s", "speed-layer"], lines: 24 }),
  "terminal-hive": (p) =>
    terminal(p, "terminal-hive.png", {
      label: "make beeline   >  SELECT * FROM top_pages LIMIT 5;",
      command: "docker",
      args: ["compose", "exec", "-T", "client", "beeline", "-u", "jdbc:hive2://hive:10000/weblogs_parallel", "-n", "hadoop",
        "--silent=true", "--outputformat=table", "-e", "SELECT * FROM top_pages LIMIT 5;"],
    }),
  "terminal-mysql": (p) =>
    terminal(p, "terminal-mysql.png", {
      label: "make mysql   >  SELECT * FROM status_distribution;",
      command: "docker",
      args: ["compose", "exec", "-T", "mysql", "mysql", "-usqoop", "-psqoop", "weblogs_parallel", "-t", "-e",
        "SELECT status, label, category, hits, pct FROM status_distribution ORDER BY hits DESC;"],
      lines: 16,
    }),
};

/**
 * The live page during a real run: re-runs the Hive analysis step from the dashboard (it rewrites
 * the same result files in HDFS, MySQL is untouched; the speed check at its end re-runs too) and
 * captures it while MapReduce jobs run.
 */
async function captureRun(page: Page) {
  const response = await fetch(`${DASHBOARD}/api/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "hive-analysis" }),
  });
  if (!response.ok) throw new Error(`could not start a run: ${await response.text()}`);
  await page.goto(`${DASHBOARD}/pipeline`, { waitUntil: "networkidle" });
  await page.waitForSelector("text=running", { timeout: 120_000 }); // a MapReduce job on YARN
  await page.waitForTimeout(8000);
  await page.setViewportSize({ width: VIEWPORT.width, height: 1650 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}dashboard-live-run.png` });
  await page.setViewportSize(VIEWPORT);
}

async function main() {
  const requested = process.argv.slice(2);
  const names = requested.length ? requested : Object.keys(SHOTS);
  const unknown = names.filter((n) => !(n in SHOTS));
  if (unknown.length) throw new Error(`unknown shot(s): ${unknown.join(", ")}; available: ${Object.keys(SHOTS).join(", ")}`);

  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2, colorScheme: "light" });
  try {
    for (const name of names) {
      process.stdout.write(`capturing ${name}... `);
      await SHOTS[name](page);
      console.log("done");
    }
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
