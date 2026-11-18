// Build docs/report.pdf, docs/slides.pdf, docs/guide.pdf and the README diagrams from the live results and the captured screenshots.
import { access, mkdtemp, rm, writeFile, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import type { Browser } from "playwright";
import { loadReport } from "./data.ts";
import { architectureSvg, sequenceSvg } from "./diagram.ts";
import { DOCS_DIR, FONT_FACES } from "./layout.ts";
import { reportHtml } from "./report.ts";
import { guideHtml } from "./guide.ts";
import { slidesHtml } from "./slides.ts";

const REQUIRED_SCREENSHOTS = [
  "dashboard-overview", "dashboard-analytics", "dashboard-pipeline",
  "hdfs-browser", "yarn-apps", "terminal-counts", "terminal-topic",
];

async function checkScreenshots() {
  const missing: string[] = [];
  for (const name of REQUIRED_SCREENSHOTS) {
    await access(`${DOCS_DIR}assets/screenshots/${name}.png`).catch(() => missing.push(name));
  }
  if (missing.length) throw new Error(`missing screenshots: ${missing.join(", ")}; run \`make screenshots\` first`);
}

async function main() {
  for (const kind of ["verification", "regression"]) {
    const root = `${DOCS_DIR}../artifacts/${kind}/`;
    const latest = (await readdir(root)).filter(name => name.endsWith(".json")).sort().at(-1);
    if (!latest || JSON.parse(await readFile(root + latest, "utf8")).status !== "pass") {
      throw new Error(`Run successful ${kind} checks before regenerating submission PDFs`);
    }
  }
  await checkScreenshots();
  const data = await loadReport();
  const documents = [
    { name: "report", html: await reportHtml(data) },
    { name: "slides", html: await slidesHtml(data) },
    { name: "guide", html: await guideHtml(data) },
  ];

  const browser = await chromium.launch();
  try {
    for (const { name, html } of documents) {
      // The HTML stays next to the sources (git-ignored) for quick visual checks in a browser.
      const htmlPath = `${DOCS_DIR}${name}/${name}.html`;
      await writeFile(htmlPath, html);
      const page = await browser.newPage();
      await page.goto(`file://${htmlPath}`, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      await page.pdf({ path: `${DOCS_DIR}${name}.pdf`, preferCSSPageSize: true, printBackground: true });
      await page.close();
      console.log(`wrote docs/${name}.pdf`);
    }
    await writeDiagramPng(browser, "architecture", architectureSvg());
    await writeDiagramPng(browser, "log-line", sequenceSvg());
  } finally {
    await browser.close();
  }
}

/** A diagram as an image for the README, on a cream card that reads in light and dark themes. */
async function writeDiagramPng(browser: Browser, name: string, svg: string) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 400 }, deviceScaleFactor: 2 });
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${FONT_FACES}
    body { margin: 0; background: transparent; }
    #card { display: inline-block; width: 900px; padding: 24px 28px 18px; border-radius: 14px; background: #f1ebe3; }
    svg { display: block; width: 100%; height: auto; }
  </style></head><body><div id="card">${svg}</div></body></html>`;
  // Loaded from a file so the bundled fonts (file:// URLs) are allowed.
  const dir = await mkdtemp(`${tmpdir()}/weblogs-diagram-`);
  try {
    await writeFile(`${dir}/diagram.html`, html);
    await page.goto(`file://${dir}/diagram.html`);
    await page.evaluate(() => document.fonts.ready);
    await page.locator("#card").screenshot({ path: `${DOCS_DIR}assets/${name}.png`, omitBackground: true });
  } finally {
    await page.close();
    await rm(dir, { recursive: true, force: true });
  }
  console.log(`wrote docs/assets/${name}.png`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
