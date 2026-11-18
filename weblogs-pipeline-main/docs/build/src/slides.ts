// Presentation deck (16:9) in the template style, built from the same data as the report.
import { dailyChart, hourlyChart, statusDonut } from "./charts.ts";
import { comparisonChart, comparisonTable } from "./comparison.ts";
import type { Report } from "./data.ts";
import { architectureSvg } from "./diagram.ts";
import { esc, hour, int, pct } from "./format.ts";
import { asset, bars, htmlDocument } from "./layout.ts";

let slideNo = 0;

function slide(body: string, opts: { cream?: boolean; className?: string; bars?: boolean } = {}): string {
  slideNo += 1;
  const withBars = opts.bars ?? true;
  return `<section class="slide ${opts.cream ? "cream" : ""} ${opts.className ?? ""}">
    ${withBars ? bars("top") : ""}${body}${withBars ? bars("bottom") : ""}
  </section>`;
}

const content = (kicker: string, title: string, inner: string) =>
  slide(`<div class="body">
      <p class="kicker label-strong">${kicker}</p>
      <h2 class="display">${title}</h2>
      ${inner}
    </div><span class="num-label">${String(slideNo + 1).padStart(2, "0")}</span>`);

const section = (n: number, title: string) =>
  slide(`<div class="display big-number">${String(n).padStart(2, "0")}</div><div class="display heading">${title}</div>`, {
    cream: true,
    className: "section",
    bars: false,
  });

const img = (src: string, alt: string, maxHeight?: number) =>
  `<div class="figure"><img src="${asset(src)}" alt="${esc(alt)}"${maxHeight ? ` style="max-height:${maxHeight}mm"` : ""}></div>`;

export async function slidesHtml(r: Report): Promise<string> {
  slideNo = 0;
  const m = r.meta;
  const peak = r.hourly.reduce((a, b) => (b.hits > a.hits ? b : a));
  const s404 = r.statuses.find((s) => s.status === 404);
  const s500 = r.statuses.find((s) => s.status === 500);

  const deck = [
    slide(
      `<div class="center">
        <p class="label-light">${esc(m.course)}</p>
        <h1 class="display">Web traffic<br>analytics pipeline</h1>
        <p class="subtitle">${esc(m.subtitle)}</p>
        <p class="authors">${m.authors.map(esc).join(" · ")}</p>
        <p class="small">${esc(m.teacher)} · ${esc(m.date)}</p>
      </div>`,
      { cream: true, className: "title-slide" },
    ),

    content(
      "The problem",
      "Millions of log lines, four questions",
      `<div class="grid-2">
        <div><p>Every visit to a web server writes one line to its access log. We want to know:</p>
          <ul class="clean" style="margin-top:4mm">
            <li>Which pages are visited the most?</li>
            <li>How does traffic vary over the day?</li>
            <li>What share of requests fail (404, 500)?</li>
            <li>Who are the most active visitors?</li>
          </ul></div>
        <div class="card"><h3>Dataset</h3>
          <p>NASA Kennedy Space Center web server, July and August 1995, Apache Common Log Format.</p>
          <p class="display" style="font-size:30pt;margin-top:5mm">${int(r.quality.total)}</p>
          <p>requests over ${r.daily.length} days</p></div>
      </div>`,
    ),

    section(1, "Architecture"),

    content("Data flow", "From a log line to a report", `<div class="figure" style="margin-top:4mm">${architectureSvg("sequential")}</div>
      <p class="small">Top row: continuous ingestion. Bottom row: batch analysis. Dashed: the status_codes reference table, imported by Sqoop into HDFS and joined by Hive.</p>`),

    content(
      "Why each tool",
      "The right tool at each step",
      `<div class="grid-3">
        <div class="card"><h3>Flume</h3><p>Collects logs with ready-made sources and sinks: configuration, no code.</p></div>
        <div class="card"><h3>Kafka</h3><p>Buffers between collection and storage; the writer resumes from its offset.</p></div>
        <div class="card"><h3>HDFS</h3><p>Distributed, fault-tolerant storage, one folder per day.</p></div>
        <div class="card"><h3>Hive</h3><p>SQL over HDFS, compiled to MapReduce jobs on YARN.</p></div>
        <div class="card"><h3>Sqoop</h3><p>Bulk transfers MySQL ↔ HDFS, in both directions.</p></div>
        <div class="card"><h3>Docker</h3><p>One cluster, two architectures, the same cluster on every machine.</p></div>
      </div>`,
    ),

    content("Architecture B", "Three counters, independent deliveries",
      `<div class="figure">${architectureSvg("parallel").replace("<svg ", '<svg style="max-height:85mm" ')}</div>
       <p class="small">Flume stores raw lines; Kafka carries structured events; Sqoop imports checked reference data.
       Separate folders and databases; stable event IDs support logical deduplication after retries.</p>`),
    content("Comparison", "Same inputs, measured outcomes", comparisonTable(r)),
    content("Comparison", "What the timings mean", `${comparisonChart(r)}
      <p>A and B run one after the other on the same DataNode. Delivery and file-closing times are measured separately.</p>
      <p class="small">A demonstrates one buffered chain. B permits independent collectors, with extra code and reconciliation.
      B also stores JSON events. Different rollover timers affect closure latency; this is a laptop experiment.</p>`),
    section(2, "Implementation"),

    content(
      "Docker",
      "One cluster, two architectures",
      `<div class="grid-2" style="grid-template-columns:2fr 3fr">
        <ul class="clean">
          <li>One image for Hadoop, Hive, Flume and Sqoop, one role per container.</li>
          <li>Kafka, ZooKeeper and MySQL from official images.</li>
          <li>Health checks order the start-up; <code>make up</code> waits for them.</li>
        </ul>
        ${img("assets/screenshots/terminal-status.png", "make status")}
      </div>`,
    ),

    content(
      "Ingestion",
      "Near-real-time, without loss",
      `<div class="grid-2">
        <ul class="clean">
          <li>A replayer appends the 1995 lines as live traffic and saves its position.</li>
          <li>Flume agent 1 reads each line's request time into the event header.</li>
          <li>Kafka carries it; agent 2 writes HDFS folders <code>dt=1995-07-01</code>…</li>
          <li>File channels and <code>acks=all</code>: buffered events survive restarts.</li>
        </ul>
        ${img("assets/screenshots/terminal-topic.png", "Messages in the Kafka topic, with their timestamp header")}
      </div>`,
    ),

    content(
      "Proof",
      "Every line reached HDFS",
      `<div class="grid-2">
        ${img("assets/screenshots/terminal-counts.png", "No-loss check")}
        <div><div class="kpis" style="grid-template-columns:1fr 1fr">
            <div class="kpi"><p class="value">${int(r.quality.total)}</p><p class="name">Lines replayed</p></div>
            <div class="kpi"><p class="value">${int(r.quality.total)}</p><p class="name">Lines in HDFS</p></div>
            <div class="kpi"><p class="value">${r.daily.length}</p><p class="name">Days of traffic</p></div>
            <div class="kpi"><p class="value">${int(r.quality.malformed)}</p><p class="name">Malformed, counted</p></div>
          </div>
          <p class="small" style="margin-top:5mm">Stopping Flume agent 2 lets messages pile up in Kafka; on restart the lag drains to zero.</p></div>
      </div>`,
    ),

    content(
      "Analysis",
      "SQL on raw files",
      `<div class="grid-2">
        <ul class="clean">
          <li>External Hive table over the HDFS folders, split by a regex (<code>RegexSerDe</code>).</li>
          <li>Malformed lines become empty rows: measured, never silently dropped.</li>
          <li>Sqoop imports <code>status_codes</code> from MySQL; Hive joins it with the logs.</li>
          <li>Six result tables exported back to MySQL by Sqoop.</li>
        </ul>
        ${img("assets/screenshots/yarn-apps.png", "MapReduce jobs in YARN")}
      </div>`,
    ),

    section(3, "Results"),

    content(
      "When",
      `Traffic peaks at ${hour(peak.hour)}`,
      `<div class="grid-2" style="grid-template-columns:3fr 2fr">
        <div class="figure">${hourlyChart(r.hourly, { height: 300 })}</div>
        <div class="figure">${dailyChart(r.daily, { width: 480, height: 300 })}
          <p class="small">Requests per day: weekly cycles, quieter weekends.</p></div>
      </div>`,
    ),

    content(
      "What and who",
      "Logos, errors and proxies",
      `<div class="grid-2">
        <div class="figure">${statusDonut(r.statuses)}</div>
        <div>
          <table class="data"><tr><th>Finding</th><th class="num">Value</th></tr>
            <tr><td>Top resource: <code>${esc(r.topPages[0].path)}</code></td><td class="num">${int(r.topPages[0].hits)}</td></tr>
            <tr class="highlight"><td>404 Not Found</td><td class="num">${int(s404?.hits ?? 0)} (${pct(s404?.pct ?? 0)})</td></tr>
            <tr class="highlight"><td>500 Internal Server Error</td><td class="num">${int(s500?.hits ?? 0)} (${pct(s500?.pct ?? 0, 4)})</td></tr>
            <tr><td>Top host: <code>${esc(r.topHosts[0].host)}</code></td><td class="num">${int(r.topHosts[0].hits)}</td></tr>
          </table>
          <p class="small" style="margin-top:4mm">Every page loads the same logos; the busiest clients are ISP proxies serving many users.</p>
        </div>
      </div>`,
    ),

    content(
      "From the terminal",
      "Results in Hive, then in MySQL",
      `<div class="grid-2">
        ${img("assets/screenshots/terminal-hive.png", "Beeline: top_pages in Hive")}
        ${img("assets/screenshots/terminal-mysql.png", "MySQL: status_distribution exported by Sqoop")}
      </div>`,
    ),

    content("From the web", "Run it and follow it from the browser", img("assets/screenshots/dashboard-run.png", "Live pipeline page during a run", 112)),

    content(
      "From the web",
      "Results and cluster interfaces",
      `<div class="grid-2">
        ${img("assets/screenshots/dashboard-overview.png", "Dashboard overview")}
        ${img("assets/screenshots/hdfs-browser.png", "HDFS NameNode: one folder per day")}
      </div>`,
    ),

    content(
      "Assessment",
      "Problems we solved",
      `<table class="data">
        <tr><th>Problem</th><th>Fix</th></tr>
        <tr><td>Apache archive throttled to ~100 KB/s</td><td>CDN and mirror, checksum-verified, resumable</td></tr>
        <tr><td>YARN refused jobs on a 93% full disk</td><td>Health check by free space (2 GB) instead of percentage</td></tr>
        <tr><td>August replayed before July</td><td>Input files sorted in calendar order</td></tr>
        <tr><td>Sqoop mapped MySQL columns alphabetically</td><td>Explicit column lists for every transfer</td></tr>
      </table>
      <p class="small">Scope: a single-node cluster, by design. The same configuration scales to more DataNodes and brokers.</p>`,
    ),

    slide(
      `<div class="center">
        <h1 class="display">Thank you</h1>
        <p class="authors">${m.authors.map(esc).join(" · ")}</p>
        <p class="small">${esc(m.course)} · ${esc(m.teacher)}</p>
      </div>`,
      { cream: true, className: "title-slide" },
    ),
  ];
  return htmlDocument(`${m.title} — slides`, "slides/slides.css", deck.join("\n"));
}
