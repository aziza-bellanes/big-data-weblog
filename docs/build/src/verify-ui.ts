// Browser checks and review captures against the real stack.
// --readiness checks the disabled and error states of the run controls with browser-local fixtures.
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { DOCS_DIR } from "./layout.ts";

const base = process.env.DASHBOARD_URL ?? "http://localhost:3030";
const out = `${DOCS_DIR}../artifacts/ui`;

async function main() {
  const browser = await chromium.launch();
  try {
    if (process.argv.includes("--readiness")) {
      const context = await browser.newContext();
      const snapshot = await (await context.request.get(`${base}/api/pipeline`)).json();
      if (!snapshot.control) throw new Error("control service unavailable");
      snapshot.control.active = [];
      snapshot.control.current = null;
      snapshot.control.replayRunning = { parallel: false };
      snapshot.replay.linesWritten = 0;
      snapshot.producer.linesWritten = 0;
      const blocked = "HDFS is in safe mode and cannot write.";
      snapshot.control.readiness = { ready: false, problems: [blocked] };
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/api/pipeline", (route) => route.fulfill({ json: snapshot }));
      // These are browser-local fixtures: no real cluster state or job is changed.
      const refused = "Not enough disk space for this replay.";
      await page.route("**/api/jobs", (route) => route.fulfill({ status: 503, json: { error: refused } }));
      await page.goto(`${base}/pipeline`, { waitUntil: "networkidle" });
      await page.getByText(blocked, { exact: true }).waitFor();
      const start = page.getByRole("button", { name: "Start the three branches", exact: true });
      if (!await start.isDisabled()) throw new Error("ingestion remains enabled during safe mode");
      if (!await page.getByRole("button", { name: "Run batch pipeline", exact: true }).isDisabled()) {
        throw new Error("batch remains enabled during safe mode");
      }
      if (!await page.getByRole("button", { name: "Start again from zero", exact: true }).isEnabled()) {
        throw new Error("reset cannot reclaim space while YARN is unavailable");
      }
      await mkdir(out, { recursive: true });
      await page.screenshot({ path: `${out}/readiness-blocked.png`, fullPage: true });
      snapshot.control.readiness = { ready: true, problems: [] };
      await page.reload({ waitUntil: "networkidle" });
      await start.click();
      await page.getByText(refused, { exact: true }).waitFor();
      await page.screenshot({ path: `${out}/replay-space-error.png`, fullPage: true });
      if (errors.length) throw new Error(errors.join("\n"));
      await context.close();
      console.log("Readiness warning, disabled start, recovery reset and replay error checks passed.");
      return;
    }
    await mkdir(out, { recursive: true });
    const problems: string[] = [];
    for (const scheme of ["light", "dark"] as const) {
      for (const width of [1440, 390]) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
        const page = await context.newPage();
        page.on("pageerror", (error) => problems.push(`${scheme}/${width}: ${error.message}`));
        for (const path of ["/", "/analytics", "/realtime", "/pipeline", "/explorer"]) {
          const label = `${scheme}-${width}-${path.slice(1) || "overview"}`;
          const response = await page.goto(base + path, { waitUntil: "networkidle" });
          if (!response?.ok()) problems.push(`${label}: HTTP ${response?.status()}`);
          await page.locator("h1").first().waitFor({ state: "visible" });
          await page.waitForTimeout(1500);
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
          if (overflow) problems.push(`${label}: horizontal page overflow`);
          await page.screenshot({ path: `${out}/${label}.png`, fullPage: true });
          console.log(label);
        }
        await context.close();
      }
    }
    if (problems.length) throw new Error(problems.join("\n"));
    console.log("All 20 page, theme and viewport checks passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => { console.error(error); process.exit(1); });
