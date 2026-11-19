// Build docs/report.pdf, docs/slides.pdf, docs/guide.pdf and the README diagrams from the live results and the captured screenshots.
import { access, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { loadReport } from "./data.ts";
import { writeDiagrams } from "./diagrams.ts";
import { DOCS_DIR } from "./layout.ts";
import { reportHtml } from "./report.ts";
import { guideHtml } from "./guide.ts";
import { slidesHtml } from "./slides.ts";

// The other shots (HDFS browser, topic, counts, realtime page...) are optional: they appear in the
// documents once `make screenshots` has captured them.
const REQUIRED_SCREENSHOTS = [
  "dashboard-overview", "dashboard-analytics", "yarn-apps", "dashboard-explorer", "dashboard-pipeline-parallel",
];

async function checkScreenshots() {
  const missing: string[] = [];
  for (const name of REQUIRED_SCREENSHOTS) {
    await access(`${DOCS_DIR}assets/screenshots/${name}.png`).catch(() => missing.push(name));
  }
  if (missing.length) throw new Error(`missing screenshots: ${missing.join(", ")}; run \`make screenshots\` first`);
}

async function main() {
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
      const overflow = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".content, .slide .body")]
        .flatMap((body, index) => {
          const frame = body.closest("section")!.getBoundingClientRect();
          const area = body.getBoundingClientRect();
          const bottom = Math.max(...[...body.children].map((child) => child.getBoundingClientRect().bottom));
          return body.scrollWidth > body.clientWidth + 2 || bottom > area.bottom + 2
            ? [`${body.querySelector("h2")?.textContent ?? `content ${index + 1}`}: width ${body.scrollWidth}/${body.clientWidth}, bottom ${Math.round(bottom - frame.top)}/${Math.round(area.bottom - frame.top)}`] : [];
        }));
      if (overflow.length) throw new Error(`${name}: layout overflow: ${overflow.join("; ")}`);
      await page.pdf({ path: `${DOCS_DIR}${name}.pdf`, preferCSSPageSize: true, printBackground: true });
      await page.close();
      console.log(`wrote docs/${name}.pdf`);
    }
    await writeDiagrams(browser);
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
