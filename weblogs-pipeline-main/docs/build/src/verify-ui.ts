// Browser checks and review captures against the real stack.
// --compare starts a fresh full comparison through the same controls a user clicks.
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { DOCS_DIR } from "./layout.ts";

const base = process.env.DASHBOARD_URL ?? "http://localhost:3030";
const out = `${DOCS_DIR}../artifacts/ui`;

async function main() {
  const browser = await chromium.launch();
  try {
    if (process.argv.includes("--compare")) {
      const page = await browser.newPage();
      await page.goto(`${base}/compare`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Compare A and B", exact: true }).click();
      const started = page.waitForResponse((r) => r.url().endsWith("/api/jobs") && r.request().method() === "POST");
      await page.getByRole("button", { name: "Empty and compare", exact: true }).click();
      const response = await started;
      if (response.status() !== 202) throw new Error(`comparison failed: ${await response.text()}`);
      const job = await response.json();
      if (job.params.limit !== 0 || job.params.rate !== 5000 || !job.params.fresh) {
        throw new Error(`unexpected comparison settings: ${JSON.stringify(job.params)}`);
      }
      console.log(`Full comparison started from the browser: ${job.id}`);
      return;
    }

    await mkdir(out, { recursive: true });
    const problems: string[] = [];
    for (const arch of ["sequential", "parallel"] as const) {
      for (const scheme of ["light", "dark"] as const) {
        for (const width of [1440, 390]) {
          const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
          await context.addCookies([{ name: "arch", value: arch, url: base }]);
          const page = await context.newPage();
          page.on("pageerror", (error) => problems.push(`${arch}/${scheme}/${width}: ${error.message}`));
          for (const path of ["/", "/analytics", "/pipeline", "/compare", "/explorer"]) {
            const label = `${arch}-${scheme}-${width}-${path.slice(1) || "overview"}`;
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
    }
    if (problems.length) throw new Error(problems.join("\n"));
    console.log("All 40 page, architecture, theme and viewport checks passed.");
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => { console.error(error); process.exit(1); });
