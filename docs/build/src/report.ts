// The written report ("compte rendu"), page by page, in the structure of the template:
// cover, contents, numbered section dividers, content pages, annex, closing page.
import { dailyChart, hourlyChart, statusDonut } from "./charts.ts";
import type { Report } from "./data.ts";
import { architectureSvg } from "./diagram.ts";
import { bytes, esc, hour, int, pct } from "./format.ts";
import { asset, htmlDocument } from "./layout.ts";
import { createPages, figure, hasAsset, optionalFigure } from "./pages.ts";

const SECTIONS = [
  "Introduction",
  "Architecture and tools",
  "Implementation",
  "Results",
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
     ecosystem tools studied in the course. It is a Lambda architecture: a batch layer for exact history and a speed
     layer for answers within seconds.</p>
     <h3 class="label-light">Objectives</h3>
     <ul class="clean narrow">
       <li>Start three ingestion branches together: <strong>Flume</strong> for the raw log lines,
           <strong>Kafka</strong> for structured events, <strong>Sqoop</strong> for reference data. All end in
           <strong>HDFS</strong>, without loss, partitioned by day.</li>
       <li>Add a <strong>speed layer</strong>: <strong>Spark</strong> Structured Streaming reads the Kafka topic and
           gives per-minute traffic and alerts within seconds, while the batch layer stays exact.</li>
       <li>Answer four questions with <strong>Hive</strong>: top 10 pages, traffic per hour, share of 404/500 errors,
           top 10 client hosts. Two more come from Spark: suspicious activity, and whether both layers agree.</li>
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
    ["Flume", "Collects the raw log lines", "Ready-made sources and sinks for logs: configured, not coded. Its HDFS files are the exact history."],
    ["Kafka", "Structured events, two consumers", "Durable and replayable: the HDFS writer and Spark read the same topic at their own pace."],
    ["Spark", "Speed layer on the Kafka topic", "Structured Streaming: per-minute traffic and alerts every 5 seconds, written to HDFS and MySQL."],
    ["HDFS", "Raw, event, speed and result zones", "Distributed, fault-tolerant storage for large append-only files."],
    ["Hive", "SQL over HDFS", "Queries in SQL, executed as MapReduce jobs on YARN."],
    ["Sqoop", "MySQL ↔ HDFS transfers", "Reference import and result export, as MapReduce jobs."],
    ["MySQL", "Results, reference, speed tables", "The reporting database a company would actually query."],
    ["Docker", "Packaging of every service", "One command reproduces the whole cluster on any machine."],
  ];
  return contentPage(
    "Architecture",
    `<div class="figure">${architectureSvg()}<p class="caption">Figure 1 — The pipeline. Solid arrows carry log data;
     dashed arrows carry the status_codes reference table, which Sqoop imports from MySQL into HDFS for the Hive join.</p></div>
     <h3 class="label-light">Why each tool</h3>
     <table class="data"><tr><th>Tool</th><th>Role</th><th>Why it is here</th></tr>
     ${tools.map(([t, role, why]) => `<tr><td><strong>${t}</strong></td><td>${role}</td><td>${why}</td></tr>`).join("")}
     </table>`,
  );
}

function architectureBranches() {
  return contentPage("Three branches, one pipeline",
    `<p>The three ingestion branches start together and each one ends in HDFS. Kafka is not a detour: it is
     linked to HDFS by its writer, and read a second time by Spark.</p>
     <ul class="clean"><li><strong>Flume</strong> TAILDIR writes the original lines directly to <code>/data/nasa/raw/flume</code>.
     This is the batch layer's input.</li>
     <li><strong>Kafka</strong>: the Python producer publishes one JSON event per line to <code>web-events</code>. The HDFS
     writer publishes closed files before committing Kafka offsets. Retries can duplicate events; Hive's
     <code>kafka_events_unique</code> view deduplicates by stable <code>event_id</code>.</li>
     <li><strong>Sqoop</strong> imports <code>status_codes</code> into a staging directory, checks it, then swaps it into place.</li></ul>
     <p>Event IDs identify the source file and line number, so repeated requests remain distinct. Process locks
     prevent two producers or replayers from reusing the same checkpoint. The control API locks resources and allows
     the independent branches to overlap.</p>
     <p>Folders, topic and the Hive/MySQL database <code>weblogs_parallel</code> are defined once in
     <code>config/architectures.json</code>. The raw Flume branch is the source of the six analytical tables;
     <code>make verify-ingestion</code> reconciles every branch with its own source before the analysis.</p>
     <h3 class="label-light">Why this shape</h3>
     <p>Before the speed layer, Kafka only made a second copy of the same lines that nobody used. Now Flume gives
     the exact history, Kafka and Spark give answers within seconds, and Sqoop brings the reference data. The cost
     is one more container: Spark adds about 1 to 2 GB of memory.</p>`);
}

function speedLayer() {
  return contentPage("The speed layer",
    `<p>Spark Structured Streaming (service <code>spark-streaming</code>, <code>scripts/spark_speed_layer.py</code>)
     is the second consumer of <code>web-events</code>. Every 5 seconds it takes a micro-batch, computes per-minute
     traffic (hits, 4xx, 404, 5xx, bytes) and requests per host and minute, and writes them to two places.</p>
     <table class="data"><tr><th>Destination</th><th>Content</th><th>Used by</th></tr>
     <tr><td>HDFS Parquet, <code>/data/nasa/streaming/spark/…/batch_id=N</code></td><td>The record, one folder per micro-batch</td><td>Hive tables <code>speed_minute_parts</code>, views <code>speed_traffic_minute</code> and <code>speed_alerts</code></td></tr>
     <tr><td>MySQL <code>speed_minute</code>, <code>speed_host_minute</code>, <code>speed_alerts</code>, <code>speed_batches</code></td><td>Serving tables</td><td>The dashboard's Real-time page</td></tr></table>
     <h3 class="label-light">Alerts</h3>
     <p>Four rules, each above the 99.9th percentile of a normal NASA minute (217 hits, 13 not-found, 16 requests
     from one host): <code>traffic_spike</code> at 300 hits per minute or more, <code>not_found_burst</code> at 15
     404s, <code>server_errors</code> at 3 5xx, <code>host_flood</code> at 30 requests from one host.</p>
     <h3 class="label-light">Exactly once</h3>
     <p>Each micro-batch writes its own <code>batch_id</code> folder, overwritten if Spark replays it. MySQL skips a
     <code>batch_id</code> already in <code>speed_batches</code>, and that row is written in the same transaction as
     the totals. The read position is the Spark checkpoint in HDFS, kept across <code>make reset</code>. On its first
     start Spark begins at the end of the topic, so the producer waits until Spark is listening.</p>
     <h3 class="label-light">Two independent paths must agree</h3>
     <p>At the end of <code>make hive-analysis</code>, <code>hive/05_speed_check.sql</code> compares, for every day,
     Spark's totals (from Kafka) with Hive's <code>hits_per_day</code> (from Flume's raw lines). The pipeline fails
     unless they are equal. <code>make verify-ingestion</code> also waits until Spark has processed the topic to its end.</p>`);
}

function implementationDocker() {
  const services: [string, string][] = [
    ["mysql", "MySQL 8: status_codes, result tables, speed tables, Hive metastore"],
    ["zookeeper, kafka", "Kafka broker in ZooKeeper mode; kafka-init creates the topic web-events"],
    ["hadoop", "HDFS NameNode + DataNode, YARN, MapReduce history server"],
    ["hive", "Hive metastore and HiveServer2 (JDBC on port 10000)"],
    ["flume-direct", "Flume branch: raw lines into HDFS"],
    ["kafka-producer, kafka-hdfs-writer", "Kafka branch: JSON events in, JSON files in HDFS out"],
    ["spark-streaming", "Speed layer: Spark 3.5.9 in local mode, second consumer of the topic (about 1 to 2 GB of memory)"],
    ["replayer", "Replays the 1995 logs as live traffic, resumable"],
    ["client", "Tool container for Sqoop, HDFS and beeline commands"],
    ["dashboard", "Next.js web UI: results, real-time page and live pipeline state"],
  ];
  return contentPage(
    "Implementation",
    `<h3 class="label-light">One command, the same cluster everywhere</h3>
     <p>The VM installation of the course was replaced by Docker Compose: the Dockerfile and configuration files are
     the documented installation. Hadoop 3.3.6, Hive 3.1.3, Flume 1.9.0, Sqoop 1.4.7 and Spark 3.5.9 share the same
     libraries and settings, so they are built into a <strong>single image</strong> and each container starts it in a
     different role. Downloads are verified against the official Apache checksums.</p>
     <table class="data"><tr><th>Service</th><th>Content</th></tr>
     ${services.map(([s, c]) => `<tr><td class="mono">${s}</td><td>${c}</td></tr>`).join("")}</table>
     <h3 class="label-light">Ingestion</h3>
     <ul class="clean">
       <li><strong>Replay.</strong> A Python script appends the 1995 lines to <code>access.log</code> at a set rate
           and saves its position, so a restart neither duplicates nor skips lines.</li>
       <li><strong>Flume</strong> tails the file (TAILDIR), reads the request time of each line into the event header
           and writes HDFS files under <code>/data/nasa/raw/flume/dt=YYYY-MM-DD</code>: data lands in the day it
           happened, not the day it was ingested. Files in progress start with <code>_</code>, which Hive ignores.</li>
       <li><strong>Kafka branch.</strong> The producer publishes JSON events with <code>acks=all</code>; the writer
           stores them in HDFS; Spark computes the live figures.</li>
       <li>The Flume agent uses a <strong>file channel</strong>, so buffered events survive a restart.</li>
     </ul>`,
  );
}

function recovery(r: Report) {
  const record = r.recovery[0];
  const first = record.samples[0];
  const last = record.samples[record.samples.length - 1];
  return contentPage("Recovery after a writer outage",
    `<p>This probe uses a partial dataset with unread events, so ingestion can continue during the outage.</p>
     <table class="data"><tr><th>Scenario</th><th>Lag during outage</th><th>Final lag</th><th>Additional source events</th><th>Result</th></tr>
     <tr><td>Kafka writer paused</td><td>${int(record.samples[1].lag)}</td><td>${int(last.lag)}</td>
     <td>${int((last.replayed ?? last.produced ?? 0) - (first.replayed ?? first.produced ?? 0))}</td><td>PASS</td></tr></table>
     <p>The Kafka HDFS writer is paused for 20 seconds. The producer keeps publishing; after resume, committed
     offsets catch up and source reconciliation passes for every branch. The speed layer is a separate consumer
     group with its own checkpoint, so a paused writer does not stop it.</p>
     <h3 class="label-light">What this establishes</h3><p>The test demonstrates buffering and restart recovery on
     one machine. Physical delivery to HDFS remains at least once: a timed-out write can duplicate a batch. Raw
     counts and content checks reject such a run; structured Kafka IDs support logical deduplication in Hive. The
     speed layer's MySQL totals are exactly once, thanks to the <code>batch_id</code> rule.</p>
     <p class="small">Evidence record: ${esc(record.run_id)}.</p>`);
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
     YARN jobs; the live flow shows every stage from the MySQL source and the Sqoop import to the Sqoop export and the dashboard, with Kafka's two consumers. It can also run the pipeline: its buttons call a small
     control API in the client container, which runs the same scripts as the <code>make</code> targets, with resource
     locks, and streams their output back to the page.</p>
     <p>The <strong>Real-time</strong> page reads the speed tables in MySQL: key figures, traffic per minute, the
     alerts and a table comparing the speed layer with the batch layer.</p>
     <div class="figure comparison-evidence"><img src="${asset("assets/screenshots/dashboard-pipeline-parallel.png")}" alt="Live pipeline flow" style="max-height:100mm"><p class="caption">Figure 3 — Live pipeline page: the flow of every stage.</p></div>`,
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
     folder (<code>dt=1970-01-01</code>) for the single line that has no date (the last line of the July file, cut
     off), which Flume keeps instead of dropping it. The speed layer agrees: for every day, Spark's totals equal Hive's. The check compares the number of lines in the replayed file with the
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
     collected by Flume, carried by Kafka, stored in HDFS without loss, analysed with Hive and exported with Sqoop,
     which also imported the reference data. Spark adds live per-minute figures and alerts from the same Kafka
     topic, and the pipeline checks that the speed layer and the batch layer report the same traffic. The four
     questions have clear answers, and the same commands reproduce them on any machine with Docker.</p>
     <p class="narrow">On a real cluster, the next steps would be more DataNodes with a replication factor of 3,
     several Kafka brokers, a Spark cluster instead of local mode, a columnar format such as ORC or Parquet for the
     result tables, and a scheduler to run the batch part every night.</p>
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
make up          # start MySQL, Hadoop, Kafka, Spark, Flume, Hive and the dashboard
make db-init     # ensure the reporting database and its speed tables exist
make replay      # start the three ingestion branches
make speed-layer # live Spark figures: latest minutes and alerts
make counts      # source lines = HDFS lines
make pipeline    # tables, branch checks, Hive analysis + speed check, export
make mysql       # query the results; dashboard on http://localhost:3030</pre>
     <h3 class="label-light">Key configuration: event time as partition key</h3>
     <pre class="code">direct.sources.tail.interceptors.eventtime.type  = regex_extractor
direct.sources.tail.interceptors.eventtime.regex = \\[(\\d{2}/[A-Za-z]{3}/\\d{4}:\\d{2}:\\d{2}:\\d{2})
direct.sources.tail.interceptors.eventtime.serializers.millis.name    = timestamp
direct.sources.tail.interceptors.eventtime.serializers.millis.pattern = dd/MMM/yyyy:HH:mm:ss
direct.sinks.hdfs.hdfs.path = hdfs://hadoop:9000/data/nasa/raw/flume/dt=%Y-%m-%d</pre>
     ${optionalFigure("assets/screenshots/no-loss-check.png", "Figure 7 — No-loss check after the full replay.")}`,
  );
}

function annexTerminal() {
  const shots = [
    optionalFigure("assets/screenshots/cluster-status.png", "Figure 8 — Long-running services are healthy; one-shot jobs have completed."),
    `<div class="two-col">
       ${optionalFigure("assets/screenshots/hdfs-zones.png", "Figure 9 — make hdfs-ls: one HDFS folder per day of traffic.")}
       ${optionalFigure("assets/screenshots/kafka-events.png", "Figure 10 — make topic-peek: JSON events in the Kafka topic.")}
     </div>`,
  ];
  return contentPage(
    "Annex B — From the terminal",
    `<p>Real output of the <code>make</code> targets after the full run, captured by <code>make screenshots</code>.</p>
     ${shots.join("")}`,
  );
}

function annexTerminalResults() {
  return contentPage(
    "Annex B — From the terminal (continued)",
    `${figure("assets/screenshots/terminal-hive.png", "Figure 11 — A Hive result table queried with Beeline.")}
     ${figure("assets/screenshots/terminal-mysql.png", "Figure 12 — The same analysis exported to MySQL by Sqoop, with the imported labels.")}`,
  );
}

function annexTerminalSpeed() {
  return contentPage(
    "Annex B — From the terminal (continued)",
    optionalFigure("assets/screenshots/terminal-speed.png", "Figure 13 — make speed-layer: the latest minutes and alerts written by Spark."),
  );
}

function annexWebMore() {
  return contentPage(
    "Annex C — From the web",
    `<div class="two-col">
       ${optionalFigure("assets/screenshots/hdfs-raw-zone.png", "Figure 14 — Day partitions in the HDFS NameNode browser.")}
       ${figure("assets/screenshots/dashboard-dark.png", "Figure 15 — Overview page in dark mode.")}
     </div>
     ${figure("assets/screenshots/yarn-apps.png", "Figure 16 — MapReduce jobs of Hive and Sqoop in the YARN ResourceManager.")}`,
  );
}

function annexAnalytics() {
  return contentPage("Annex C - Analytics",
    figure("assets/screenshots/dashboard-analytics.png", "Figure 17 - Analytics page of the dashboard.", "comparison-evidence"));
}

function annexRealtime() {
  return contentPage("Annex C - Real-time page",
    figure("assets/screenshots/dashboard-realtime.png", "Figure 18 - Real-time page: the speed layer's figures and alerts.", "comparison-evidence"));
}

function annexRun2() {
  return contentPage("Annex C - Live pipeline",
    figure("assets/screenshots/dashboard-live-run.png", "Figure 19 - Live pipeline page while the Hive analysis runs, started from the browser.", "comparison-evidence"));
}

function closing(r: Report) {
  return page(
    `<p class="brand label-light">${esc(r.meta.institution)}</p>
     <p class="date">${esc(r.meta.date)}</p>
     <div class="thanks"><h1 class="display">Thank you</h1><p>${r.meta.authors.map(esc).join(" · ")}</p></div>`,
    { cream: true, className: "closing" },
  );
}

function annexExplorer() {
  return contentPage("Annex D - Data explorer",
    figure("assets/screenshots/dashboard-explorer.png", "Figure 20 - The HDFS data explorer.", "comparison-evidence"));
}

function annexParallel() {
  return contentPage("Annex D - Ingestion checks",
    figure("assets/screenshots/dashboard-pipeline-parallel.png", "Figure 21 - The data flow of the pipeline. Tool counters include earlier runs; per-run measurements use deltas.", "comparison-evidence"));
}

function annexVerify() {
  return contentPage("Annex D - Ingestion checks (continued)",
    optionalFigure("assets/screenshots/verify-ingestion.png", "Figure 22 - Source reconciliation for the Flume, Kafka, Spark and Sqoop branches."));
}

export async function reportHtml(r: Report): Promise<string> {
  const pages = [
    cover(r), contents(r),
    divider(0), introduction(r),
    divider(1), architecture(), architectureBranches(), speedLayer(),
    divider(2), implementationDocker(), implementationAnalysis(), implementationDashboard(), recovery(r),
    divider(3), results(r), resultsTables(r),
    divider(4), assessment(),
    divider(5), conclusion(r), annexRun(),
    ...(hasAsset("assets/screenshots/cluster-status.png") || hasAsset("assets/screenshots/hdfs-zones.png") || hasAsset("assets/screenshots/kafka-events.png") ? [annexTerminal()] : []),
    annexTerminalResults(),
    ...(hasAsset("assets/screenshots/terminal-speed.png") ? [annexTerminalSpeed()] : []),
    annexWebMore(), annexAnalytics(),
    ...(hasAsset("assets/screenshots/dashboard-realtime.png") ? [annexRealtime()] : []),
    ...(hasAsset("assets/screenshots/dashboard-live-run.png") ? [annexRun2()] : []),
    annexExplorer(), annexParallel(),
    ...(hasAsset("assets/screenshots/verify-ingestion.png") ? [annexVerify()] : []),
    closing(r),
  ];
  return htmlDocument(r.meta.title, "report/report.css", pages.join("\n"));
}
