// The written report ("compte rendu"), page by page, in the structure of the template:
// cover, contents, numbered section dividers, content pages, annex, closing page.
import { dailyChart, hourlyChart, statusDonut } from "./charts.ts";
import { comparisonChart, comparisonTable } from "./comparison.ts";
import type { Report } from "./data.ts";
import { architectureSvg } from "./diagram.ts";
import { bytes, esc, hour, int, pct } from "./format.ts";
import { htmlDocument } from "./layout.ts";
import { createPages, figure } from "./pages.ts";

const SECTIONS = [
  "Introduction",
  "Architecture and tools",
  "Implementation",
  "Results",
  "Comparison",
  "Assessment",
  "Conclusion",
] as const;

const { page, contentPage, divider, contents: contentsPage } = createPages(SECTIONS);

// ---- Pages ------------------------------------------------------------------------------

function cover(r: Report) {
  const m = r.meta;
  return page(
    `<div class="cover">
      <p class="brand label-light">${esc(m.institution)}</p>
      <h1 class="display">Project<br>report</h1>
      <p class="subtitle">${esc(m.title)} — ${esc(m.subtitle)}</p>
      <p class="authors">${m.authors.map(esc).join(" · ")}</p>
      <p class="meta">${esc(m.course)} · ${esc(m.teacher)}</p>
      <p class="date">${esc(m.date)}</p>
    </div>`,
    { cream: true },
  );
}

function contents(r: Report) {
  return contentsPage(r.meta.institution);
}

function introduction(r: Report) {
  return contentPage(
    "Introduction",
    `<h3 class="label-light">Context</h3>
     <p class="narrow">Every request to a web server leaves one line in an access log: who asked, when, for which
     resource, and whether it worked. A busy site produces millions of these lines a month, which is too many for a
     spreadsheet and the classic entry point into big data processing. This project builds a complete pipeline that
     collects such logs continuously, stores them durably and answers business questions with SQL, using the Hadoop
     ecosystem tools studied in the course.</p>
     <h3 class="label-light">Objectives</h3>
     <ul class="clean narrow">
       <li>Ingest log lines continuously with <strong>Flume</strong>, buffered by <strong>Kafka</strong>.</li>
       <li>Persist every line in <strong>HDFS</strong> without loss, partitioned by day.</li>
       <li>Answer four questions with <strong>Hive</strong>: top 10 pages, traffic per hour, share of 404/500 errors,
           top 10 client hosts.</li>
       <li>Move data both ways with <strong>Sqoop</strong>: results to MySQL, a reference table from MySQL.</li>
       <li>Make it reproducible, observable and decoupled, so each stage can restart on its own.</li>
     </ul>
     <h3 class="label-light">Dataset</h3>
     <p class="narrow">The NASA Kennedy Space Center HTTP logs of July and August 1995: <strong>${int(r.quality.total)}
     requests</strong> in Apache Common Log Format, big enough to be convincing and small enough for one machine.</p>
     <pre class="code">199.72.81.55 - - [01/Jul/1995:00:00:01 -0400] "GET /history/apollo/ HTTP/1.0" 200 6245
host           identity user  time                     request                     status bytes</pre>
     <h3 class="label-light">Scope</h3>
     <p class="narrow">Everything runs as a single-node (pseudo-distributed) cluster in Docker. This is a deliberate
     limit for a laptop: the configuration is the one a real cluster uses, with one node and a replication factor
     of 1.</p>`,
  );
}

function architecture() {
  const tools: [string, string, string][] = [
    ["Flume", "Collects log lines; two agents", "Ready-made sources and sinks for logs: configured, not coded."],
    ["Kafka", "Buffer between collection and storage", "Absorbs spikes; the writer can stop and resume from its offset."],
    ["HDFS", "Raw storage, one folder per day", "Distributed, fault-tolerant storage for large append-only files."],
    ["Hive", "SQL over HDFS", "Queries in SQL, executed as MapReduce jobs on YARN."],
    ["Sqoop", "MySQL ↔ HDFS transfers", "Bulk import and export in both directions, as MapReduce jobs."],
    ["MySQL", "Results, reference data, metastore", "The reporting database a company would actually query."],
    ["Docker", "Packaging of every service", "One command reproduces the whole cluster on any machine."],
  ];
  return contentPage(
    "Architecture A · Sequential",
    `<div class="figure">${architectureSvg("sequential")}<p class="caption">Figure 1 — Data flow. Solid arrows carry log data;
     dashed arrows carry the status_codes reference table, which Sqoop imports from MySQL into HDFS for the Hive join.</p></div>
     <h3 class="label-light">Why each tool</h3>
     <table class="data"><tr><th>Tool</th><th>Role</th><th>Why it is here</th></tr>
     ${tools.map(([t, role, why]) => `<tr><td><strong>${t}</strong></td><td>${role}</td><td>${why}</td></tr>`).join("")}
     </table>
     <h3 class="label-light">Why Flume, then Kafka, then Flume again</h3>
     <p>Writing straight from one Flume agent to HDFS would couple collection to storage: if HDFS is slow or down,
     collection stops. With Kafka in the middle, agent 1 keeps publishing while agent 2 is stopped, and agent 2
     catches up from its committed offset when it returns. Both agents stay pure configuration, with no custom code.</p>`,
  );
}


function architectureParallel() {
  return contentPage("Architecture B · Parallel",
    `<div class="figure">${architectureSvg("parallel")}<p class="caption">Figure 2 - Three independent ingestion branches.</p></div>
     <p>A keeps the course's Flume → Kafka → Flume chain. B explores independent collectors on the same cluster,
     dataset and analytical queries. Choose with <code>ARCH=sequential|parallel</code> or the dashboard switch.</p>
     <h3 class="label-light">Three branches, three responsibilities</h3>
     <ul class="clean"><li>Flume TAILDIR writes the original lines directly to <code>/data/nasa/raw/flume</code>.</li>
     <li>The Python producer publishes JSON events to <code>web-events</code>. The HDFS writer publishes closed
     files before committing Kafka offsets. Retries can duplicate events; Hive's <code>kafka_events_unique</code>
     view deduplicates by stable <code>event_id</code>.</li>
     <li>Sqoop imports <code>status_codes</code> into a staging directory, checks it, then swaps it into place.</li></ul>
     <p>Event IDs identify the source file and line number, so repeated requests remain distinct. Process locks
     prevent two producers or replayers from reusing the same checkpoint. The control API locks resources per
     architecture and allows independent B branches to overlap. Compare takes both architectures' resources.</p>
     <p>B uses separate HDFS folders and Hive/MySQL database <code>weblogs_parallel</code>. The raw Flume branch
     remains the canonical source for the same six analytical tables.</p>`);
}

function comparison(r: Report) {
  return contentPage("Comparison",
    `<p>A runs first, then B, at the same replay rate on the complete dataset. They share one DataNode, so the
     test measures this laptop rather than distributed production capacity.</p>${comparisonTable(r)}
     <h3 class="label-light">Time until every line is written</h3>${comparisonChart(r)}
     <p>Lower is faster. File closure is reported separately: A rolls after 300 s or 60 s idle; B's direct Flume
     sink uses 30 s or 10 s idle. File closure alone would therefore favour B's configuration.</p>
     <p>B also persists structured JSON events. A imports the reference table during its batch part; B imports it
     during ingestion and reconciles its branches before analysis. The timings cover each configured architecture.</p>
     <p>A demonstrates buffering in one chain. B permits independent ingestion and reconciliation, at the cost of
     custom code, checkpoints and deduplication. Neither design establishes exactly-once physical delivery.</p>`);
}

function implementationDocker() {
  const services: [string, string][] = [
    ["mysql", "MySQL 8: status_codes, result tables, Hive metastore"],
    ["zookeeper, kafka", "Kafka broker in ZooKeeper mode; kafka-init creates both topics"],
    ["hadoop", "HDFS NameNode + DataNode, YARN, MapReduce history server"],
    ["hive", "Hive metastore and HiveServer2 (JDBC on port 10000)"],
    ["flume-agent1, flume-agent2", "The two Flume agents, each restartable on its own"],
    ["flume-direct, kafka-producer, kafka-hdfs-writer", "B: independent raw and structured ingestion"],
    ["replayer", "Replays the 1995 logs as live traffic, resumable"],
    ["client", "Tool container for Sqoop, HDFS and beeline commands"],
    ["dashboard", "Next.js web UI: results and live pipeline state"],
  ];
  return contentPage(
    "Implementation",
    `<h3 class="label-light">One command, the same cluster everywhere</h3>
     <p>The VM installation of the course was replaced by Docker Compose: the Dockerfile and configuration files are
     the documented installation. Hadoop 3.3.6, Hive 3.1.3, Flume 1.9.0 and Sqoop 1.4.7 share the same libraries
     and settings, so they are built into a <strong>single image</strong> and each container starts it in a
     different role. Downloads are verified against the official Apache checksums.</p>
     <table class="data"><tr><th>Service</th><th>Content</th></tr>
     ${services.map(([s, c]) => `<tr><td class="mono">${s}</td><td>${c}</td></tr>`).join("")}</table>
     <h3 class="label-light">Ingestion</h3>
     <ul class="clean">
       <li><strong>Replay.</strong> A Python script appends the 1995 lines to <code>access.log</code> at a set rate
           and saves its position, so a restart neither duplicates nor skips lines.</li>
       <li><strong>Agent 1</strong> tails the file (TAILDIR), extracts the request time of each line into the event
           header with a <code>regex_extractor</code> interceptor, and publishes to Kafka with <code>acks=all</code>.</li>
       <li><strong>Agent 2</strong> consumes the topic and writes HDFS files under
           <code>/data/weblogs/dt=YYYY-MM-DD</code>, using that header: data lands in the day it happened, not the
           day it was ingested. Files in progress start with <code>_</code>, which Hive ignores.</li>
       <li>Both agents use <strong>file channels</strong>, so buffered events survive a restart.</li>
     </ul>`,
  );
}

function recovery(r: Report) {
  const rows = r.recovery.map((record, i) => {
    const first = record.samples[0];
    const last = record.samples[record.samples.length - 1];
    return `<tr><td>${i === 0 ? "A · Flume 2 stopped" : "B · Kafka writer paused"}</td>
      <td>${int(record.samples[1].lag)}</td><td>${int(last.lag)}</td>
      <td>${int((last.replayed ?? last.produced ?? 0) - (first.replayed ?? first.produced ?? 0))}</td><td>PASS</td></tr>`;
  }).join("");
  return contentPage("Recovery after a writer outage",
    `<p>These probes use partial datasets with unread events, so ingestion can continue during the outage.
     The full comparison is a separate fresh run.</p>
     <table class="data"><tr><th>Scenario</th><th>Lag during outage</th><th>Final lag</th><th>Additional source events</th><th>Result</th></tr>${rows}</table>
     <h3 class="label-light">A · Sequential</h3><p>Flume 2 is stopped for 60 seconds while Flume 1 continues to
     publish. Kafka holds the pending messages. After restart, the consumer catches up, HDFS files close and
     the complete source/HDFS line counts match.</p>
     <h3 class="label-light">B · Parallel</h3><p>The Kafka HDFS writer is paused for 20 seconds. The producer keeps
     publishing; after resume, committed offsets catch up and source reconciliation passes for every branch.</p>
     <h3 class="label-light">What this establishes</h3><p>The tests demonstrate buffering and restart recovery on
     one machine. Physical delivery remains at least once: a timed-out write can duplicate a batch. Raw counts
     and content checks reject such a run; structured Kafka IDs support logical deduplication in Hive.</p>
     <p class="small">Evidence records: ${r.recovery.map((record) => esc(record.run_id)).join("; ")}.</p>`);
}

function implementationAnalysis() {
  return contentPage(
    "Implementation",
    `<h3 class="label-light">Analysis with Hive</h3>
     <p>An external table reads the raw files in place and splits each line with a regular expression
     (<code>RegexSerDe</code>). Lines that do not match become empty rows, which is how malformed input is
     <strong>counted instead of silently dropped</strong>. A view adds typed columns (time, hour, method, path,
     status, bytes), and one <code>INSERT OVERWRITE</code> per question writes each result as a tab-separated file.</p>
     <pre class="code">'input.regex' = '^(\\\\S+) (\\\\S+) (\\\\S+) \\\\[([^\\\\]]+)\\\\] "([^"]*)" (\\\\d{3}) (\\\\S+)$'

INSERT OVERWRITE TABLE status_distribution
SELECT s.status, r.label, r.category, s.hits, round(100.0 * s.hits / t.total, 4)
FROM (SELECT status, count(*) AS hits FROM access_logs GROUP BY status) s
CROSS JOIN (SELECT count(*) AS total FROM access_logs) t
LEFT JOIN status_codes r ON r.code = s.status;</pre>
     <h3 class="label-light">Sqoop in both directions</h3>
     <ul class="clean">
       <li><strong>Import:</strong> the MySQL table <code>status_codes</code> is copied to HDFS and joined in Hive,
           so results read "404 Not Found" rather than a bare code.</li>
       <li><strong>Export:</strong> the six result tables are copied from HDFS into MySQL for reporting.</li>
       <li>Columns are named explicitly on every transfer: with the MySQL 8 driver, Sqoop 1.4.7 otherwise maps
           them in alphabetical order (see Assessment).</li>
     </ul>`,
  );
}

function implementationDashboard() {
  return contentPage(
    "Implementation - The dashboard",
    `     <h3 class="label-light">Observability</h3>
     <p>A web dashboard (Next.js, shadcn/ui), running as one more container, reads the result tables from MySQL and
     probes every stage live: replay progress, Flume counters, Kafka offsets and consumer lag, HDFS partitions and
     YARN jobs. It can also run the pipeline: its buttons call a small control API in the client container, which
     runs the same scripts as the <code>make</code> targets, with resource locks per architecture, and streams their output back to
     the page.</p>
     ${figure("assets/screenshots/dashboard-pipeline.png", "Figure 3 — Live pipeline page: run controls, the flow of every stage and the current run.")}`,
  );
}

function results(r: Report) {
  const peak = r.hourly.reduce((a, b) => (b.hits > a.hits ? b : a));
  const quiet = r.hourly.reduce((a, b) => (b.hits < a.hits ? b : a));
  const status = (code: number) => r.statuses.find((s) => s.status === code);
  return contentPage(
    "Results",
    `<div class="kpis">
       <div class="kpi"><p class="value">${int(r.quality.total)}</p><p class="name">Requests</p></div>
       <div class="kpi"><p class="value">${r.daily.length}</p><p class="name">Days</p></div>
       <div class="kpi"><p class="value">${pct(status(404)?.pct ?? 0)}</p><p class="name">404 Not Found</p></div>
       <div class="kpi"><p class="value">${int(r.quality.malformed)}</p><p class="name">Malformed lines</p></div>
     </div>
     <h3 class="label-light">No data lost</h3>
     <p>Every line replayed reached HDFS: ${int(r.quality.total)} lines in, ${int(r.quality.total)} lines stored
     in ${r.hdfs.partitions} HDFS partitions (${bytes(r.hdfs.bytes)}): ${r.daily.length} days of traffic, plus one
     folder for the single line that has no date (the last line of the July file, cut off), which Flume files under
     its arrival day instead of dropping it. The check compares the number of lines in the replayed file with the
     number of lines in HDFS (<code>make counts</code>).</p>
     <h3 class="label-light">Traffic per hour of day</h3>
     <div class="figure">${hourlyChart(r.hourly, { height: 230 })}<p class="caption">Figure 4 — Average requests per
     day for each hour (server time, UTC−4). Peak at ${hour(peak.hour)} (${int(peak.avgPerDay)} per day), lowest at
     ${hour(quiet.hour)}.</p></div>
     <h3 class="label-light">Traffic per day</h3>
     <div class="figure">${dailyChart(r.daily, { height: 230 })}<p class="caption">Figure 5 — Requests (navy) and
     distinct client hosts (sage) per day. Weekly cycles are visible: traffic drops at weekends.</p></div>`,
  );
}

function resultsTables(r: Report) {
  const rows = (items: { label: string; hits: number }[]) =>
    items.map((i, n) => `<tr><td>${n + 1}</td><td class="mono">${esc(i.label)}</td><td class="num">${int(i.hits)}</td></tr>`).join("");
  return contentPage(
    "Results",
    `<h3 class="label-light">Status codes and error rate</h3>
     <div class="two-col" style="align-items:center">
       <div class="figure">${statusDonut(r.statuses)}</div>
       <table class="data"><tr><th>Code</th><th>Meaning</th><th class="num">Requests</th><th class="num">Share</th></tr>
       ${r.statuses.map((s) => `<tr class="${s.status === 404 || s.status === 500 ? "highlight" : ""}"><td>${s.status}</td>
         <td>${esc(s.label ?? "Unknown")}</td><td class="num">${int(s.hits)}</td><td class="num">${pct(s.pct, 4)}</td></tr>`).join("")}
       </table>
     </div>
     <div class="two-col">
       <div><h3 class="label-light">Top 10 pages</h3>
         <table class="data"><tr><th>#</th><th>Path</th><th class="num">Hits</th></tr>
         ${rows(r.topPages.map((p) => ({ label: p.path, hits: p.hits })))}</table></div>
       <div><h3 class="label-light">Top 10 client hosts</h3>
         <table class="data"><tr><th>#</th><th>Host</th><th class="num">Hits</th></tr>
         ${rows(r.topHosts.map((h) => ({ label: h.host, hits: h.hits })))}</table></div>
     </div>
     <p><strong>Reading the results.</strong> Small images dominate the top pages because every HTML page loads the
     same logos; the first real page, <code>/ksc.html</code>, comes later. The busiest clients are proxies of
     internet providers (Prodigy, AOL) that forward many users at once. Server errors are rare
     (${int(r.statuses.filter((s) => s.status >= 500).reduce((a, s) => a + s.hits, 0))} requests); missing resources
     (404) are the main source of errors.</p>`,
  );
}

function assessment() {
  return contentPage(
    "Assessment",
    `<h3 class="label-strong">Strengths</h3>
     <p>The pipeline runs end to end on the full dataset with no line lost, every stage restarts independently, and
     the whole cluster is reproducible with one command. Malformed input is measured, partitions follow the real
     event date, and a live dashboard makes the data flow visible during the demonstration.</p>
     <h3 class="label-strong">Difficulties encountered</h3>
     <ul class="clean">
       <li>The Apache archive throttled downloads to about 100 KB/s, and the dataset server stalled mid-transfer.</li>
       <li>YARN refused every job: the laptop disk was over 90% full, the default limit for a healthy node.</li>
       <li>The first replay sent August before July, since files were read in alphabetical order.</li>
       <li>Sqoop with the MySQL 8 driver mapped columns alphabetically: status labels came back empty and the export
           failed on <code>"/images/NASA-logosmall.gif"</code> being read as a number.</li>
     </ul>
     <h3 class="label-strong">Solutions applied</h3>
     <ul class="clean">
       <li>Downloads from the Apache CDN and a mirror, verified against the official checksums, resumable.</li>
       <li>The NodeManager now requires 2 GB of free space instead of a percentage.</li>
       <li>Input files are replayed in calendar order.</li>
       <li>Every Sqoop transfer names its columns explicitly, defined once per table.</li>
     </ul>
     <h3 class="label-strong">Skills developed</h3>
     <p>Configuring and debugging Hadoop-ecosystem services together; reasoning about delivery guarantees and
     offsets; packaging a multi-service system with Docker; diagnosing failures from YARN and MapReduce logs; and
     presenting data through a small web application.</p>`,
  );
}

function conclusion(r: Report) {
  return contentPage(
    "Conclusion",
    `<p class="narrow">The project meets its requirements: ${int(r.quality.total)} log lines were collected by Flume,
     buffered by Kafka, stored in HDFS without loss, analysed with Hive and exported with Sqoop, which also imported
     the reference data. The four questions have clear answers, and the same commands reproduce them on any
     machine with Docker.</p>
     <p class="narrow">On a real cluster, the next steps would be more DataNodes with a replication factor of 3,
     several Kafka brokers, a columnar format such as ORC or Parquet for the result tables, and a scheduler to run
     the batch part every night.</p>
     <p class="quote-mark">&ldquo;</p>
     <p class="narrow">The most useful lesson was how much reliability comes from small decisions: an offset file,
     a file channel, an explicit column list. Each one turned a silent failure into a guarantee we could check.</p>
     ${figure("assets/screenshots/dashboard-overview.png", "Figure 6 — Overview page of the dashboard after the full run.")}`,
  );
}

function annexRun() {
  return contentPage(
    "Annex A — Running the project",
    `<p>Requirements: Docker with Compose v2, 8 GB of memory for Docker, about 20 GB of free disk, <code>make</code>.
     The full guide is <code>docs/GETTING_STARTED.md</code> in the repository.</p>
     <pre class="code">git clone https://github.com/JedidiAymen/weblogs-pipeline.git
cd weblogs-pipeline
make data        # download the NASA logs (36 MB)
make build       # build the images (first time only)
make up          # start MySQL, Hadoop, Kafka, both Flume agents, Hive and the dashboard
make db-init     # ensure both reporting databases exist
make replay ARCH=sequential    # replay A as live traffic
make counts ARCH=sequential    # source lines = HDFS lines
make pipeline ARCH=sequential  # Hive, Sqoop import, analysis, export
make mysql ARCH=sequential     # query A; dashboard on http://localhost:3030</pre>
     <h3 class="label-light">Key configuration: event time as partition key</h3>
     <pre class="code">agent1.sources.tail.interceptors.eventtime.type  = regex_extractor
agent1.sources.tail.interceptors.eventtime.regex = \\\\[(\\\\d{2}/[A-Za-z]{3}/\\\\d{4}:\\\\d{2}:\\\\d{2}:\\\\d{2})
agent1.sources.tail.interceptors.eventtime.serializers.millis.name    = timestamp
agent1.sources.tail.interceptors.eventtime.serializers.millis.pattern = dd/MMM/yyyy:HH:mm:ss
agent1.sinks.kafka.useFlumeEventFormat = true          # headers travel through Kafka
agent2.sinks.hdfs.hdfs.path = hdfs://hadoop:9000/data/weblogs/dt=%Y-%m-%d</pre>
     ${figure("assets/screenshots/terminal-counts.png", "Figure 7 — No-loss check after the full replay.")}`,
  );
}

function annexTerminal() {
  return contentPage(
    "Annex B — From the terminal",
    `<p>Real output of the <code>make</code> targets after the full run, captured by <code>make screenshots</code>.</p>
     ${figure("assets/screenshots/terminal-status.png", "Figure 8 — Long-running services are healthy; one-shot jobs have completed.")}
     <div class="two-col">
       ${figure("assets/screenshots/terminal-hdfs.png", "Figure 9 — make hdfs-ls: one HDFS folder per day of traffic.")}
       ${figure("assets/screenshots/terminal-topic.png", "Figure 10 — make topic-peek: messages in the Kafka topic, with their timestamp header.")}
     </div>`,
  );
}

function annexTerminalResults() {
  return contentPage(
    "Annex B — From the terminal (continued)",
    `${figure("assets/screenshots/terminal-hive.png", "Figure 11 — A Hive result table queried with Beeline.")}
     ${figure("assets/screenshots/terminal-mysql.png", "Figure 12 — The same analysis exported to MySQL by Sqoop, with the imported labels.")}`,
  );
}

function annexWeb() {
  return contentPage(
    "Annex C — From the web",
    `${figure("assets/screenshots/dashboard-run.png", "Figure 13 — Live pipeline page while the Hive analysis runs, started from the browser.")}`,
  );
}

function annexWebMore() {
  return contentPage(
    "Annex C — From the web (continued)",
    `<div class="two-col">
       ${figure("assets/screenshots/hdfs-browser.png", "Figure 14 — Day partitions in the HDFS NameNode browser.")}
       ${figure("assets/screenshots/dashboard-dark.png", "Figure 15 — Overview page in dark mode.")}
     </div>
     ${figure("assets/screenshots/yarn-apps.png", "Figure 16 — MapReduce jobs of Hive and Sqoop in the YARN ResourceManager.")}`,
  );
}

function annexAnalytics() {
  return contentPage("Annex C - Analytics",
    figure("assets/screenshots/dashboard-analytics.png", "Figure 17 - Analytics page of the dashboard.", "comparison-evidence"));
}

function closing(r: Report) {
  return page(
    `<p class="brand label-light">${esc(r.meta.institution)}</p>
     <p class="date">${esc(r.meta.date)}</p>
     <div class="thanks"><h1 class="display">Thank you</h1><p>${r.meta.authors.map(esc).join(" · ")}</p></div>`,
    { cream: true, className: "closing" },
  );
}

function annexComparison() {
  return contentPage("Annex D - Comparing and inspecting",
    figure("assets/screenshots/dashboard-compare.png", "Figure 18 - Recorded A/B comparison and identical result tables.", "comparison-evidence"));
}

function annexExplorer() {
  return contentPage("Annex D - Data explorer",
    figure("assets/screenshots/dashboard-explorer.png", "Figure 19 - Architecture B in the HDFS data explorer.", "comparison-evidence"));
}

function annexParallel() {
  return contentPage("Annex D - Parallel ingestion checks",
    figure("assets/screenshots/dashboard-pipeline-parallel.png", "Figure 20 - The three branches of B. Tool counters include earlier runs; comparison measurements use per-run deltas.", "comparison-evidence"));
}

function annexComparisonTerminal() {
  return contentPage("Annex D - Comparison evidence",
    `${figure("assets/screenshots/terminal-compare.png", "Figure 21 - Stored full comparison measurements.")}
     ${figure("assets/screenshots/terminal-verify.png", "Figure 22 - Source reconciliation for all three branches.")}`);
}

export async function reportHtml(r: Report): Promise<string> {
  const pages = [
    cover(r), contents(r),
    divider(0), introduction(r),
    divider(1), architecture(), architectureParallel(),
    divider(2), implementationDocker(), implementationAnalysis(), implementationDashboard(),
    divider(3), results(r), resultsTables(r),
    divider(4), comparison(r), recovery(r),
    divider(5), assessment(),
    divider(6), conclusion(r), annexRun(), annexTerminal(), annexTerminalResults(), annexWeb(), annexWebMore(), annexAnalytics(),
    annexComparison(), annexExplorer(), annexParallel(), annexComparisonTerminal(), closing(r),
  ];
  return htmlDocument(r.meta.title, "report/report.css", pages.join("\n"));
}
