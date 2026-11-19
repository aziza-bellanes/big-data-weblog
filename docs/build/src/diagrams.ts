// The README diagrams (docs/assets/architecture.png and log-line.png). `npm run diagrams` redraws
// them on their own, without the running stack that the report and slides need.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import type { Browser } from "playwright";
import { architectureSvg, sequenceSvg } from "./diagram.ts";
import { DOCS_DIR, FONT_FACES } from "./layout.ts";

export async function writeDiagrams(browser: Browser) {
  await writeDiagramPng(browser, "architecture", architectureSvg());
  await writeDiagramPng(browser, "log-line", sequenceSvg());
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

if (process.argv[1]?.endsWith("diagrams.ts")) {
  const browser = await chromium.launch();
  try {
    await writeDiagrams(browser);
  } finally {
    await browser.close();
  }
}
