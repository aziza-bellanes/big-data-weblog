// "The project, explained simply": a plain-language guide to the whole project, in the report's
// template (same cover, dividers, bars and fonts), for readers who know none of the tools.
import { architectureSvg, sequenceSvg } from "./diagram.ts";
import type { Report } from "./data.ts";
import { bytes, esc, hour, int, pct } from "./format.ts";
import { htmlDocument } from "./layout.ts";
import { createPages, figure, optionalFigure } from "./pages.ts";

const SECTIONS = ["The big picture", "Every tool", "One line's journey", "The website", "Words and questions"] as const;

const { page, contentPage, divider, contents } = createPages(SECTIONS);

interface Tool {
  name: string;
  nickname: string;
  /** Where the tool sits in the post office picture. */
  picture: string;
  body: string;
}

const toolBlock = (n: number, t: Tool) => `<article class="tool">
    <header><span class="tool-number">${n}</span><h3>${t.name}</h3><span class="nickname">${t.nickname}</span></header>
    ${t.body}
    <p class="picture"><strong>In the picture:</strong> ${t.picture}</p>
  </article>`;

const toolsPage = (title: string, first: number, tools: Tool[]) =>
  contentPage(title, tools.map((t, i) => toolBlock(first + i, t)).join(""));

// ---- Pages ------------------------------------------------------------------------------


function twoWays() {
  return contentPage("Three counters, two layers",
    `<p>The post office has three counters that open together. Flume stores the original letters. Kafka carries a
     structured copy of every letter. Sqoop brings the address book. Each counter can work independently; afterwards
     we check that its delivery matches its own source.</p>
     <p>Kafka's copies are read by <strong>two people</strong>: the truck driver, who archives them in the warehouse,
     and a <strong>scoreboard operator</strong> (Spark) who keeps a running tally per minute and rings a bell when
     something looks wrong, a few seconds after the letters arrive.</p>
     <div class="figure">${architectureSvg()}</div>
     <div class="figure">${sequenceSvg()}</div>`);
}

function whySpeed() {
  return contentPage("Why a scoreboard as well?",
    `<p>Before, Kafka only made a second copy of the same lines that nobody used. Now each path has its own job:</p>
     <table class="data"><tr><th>Path</th><th>Answers</th><th>Good at</th></tr>
     <tr><td><strong>Flume, then Hive</strong> (batch layer)</td><td>The exact history, after the run</td><td>Complete and precise, but minutes later</td></tr>
     <tr><td><strong>Kafka, then Spark</strong> (speed layer)</td><td>Traffic per minute and alerts, within seconds</td><td>Fast, while the visits are still arriving</td></tr>
     <tr><td><strong>Sqoop</strong></td><td>The code names from MySQL</td><td>Reference data for both</td></tr></table>
     <p>This combination is called a <strong>Lambda architecture</strong>. The two paths are computed from two
     different copies of the letters. At the end of the analysis the project <strong>compares them day by day</strong>
     and stops with an error if Spark's totals differ from Hive's: two independent paths agreeing is a strong proof.</p>
     <p>The scoreboard rings its bell above the 99.9th percentile of a normal minute: 300 visits in a minute, 15
     "not found", 3 server crashes, or 30 visits from one computer.</p>
     <p>Spark never counts a minute twice: every 5-second batch is saved in its own folder and MySQL ignores a batch
     it has already added. The price is one more box that needs about 1 to 2 GB of memory.</p>`);
}

function cover(r: Report) {
  const m = r.meta;
  return page(
    `<div class="cover">
      <p class="brand label-light">${esc(m.institution)}</p>
      <h1 class="display">The project,<br>explained</h1>
      <p class="subtitle">${esc(m.title)}: every tool and every step in plain words, for readers who know none of them</p>
      <p class="authors">${m.authors.map(esc).join(" · ")}</p>
      <p class="meta">${esc(m.course)} · ${esc(m.teacher)}</p>
      <p class="date">${esc(m.date)}</p>
    </div>`,
    { cream: true },
  );
}

function story(r: Report) {
  const peak = r.hourly.reduce((a, b) => (b.hits > a.hits ? b : a));
  const s404 = r.statuses.find((s) => s.status === 404);
  const s500 = r.statuses.find((s) => s.status === 500);
  return contentPage(
    "The story in 30 seconds",
    `<p class="lead">A NASA website from 1995 wrote down <strong>every visit</strong> in a big text file:
     ${int(r.quality.total)} lines over two months. We built a small <strong>factory</strong> that plays those visits
     back as if they were happening now, carries every line safely to a big storage, counts and analyses everything,
     puts the answers in a database and shows them on a website.</p>
     <h3 class="label-light">The questions we answer</h3>
     <table class="data">
       <tr><th>Question</th><th>Answer we found</th></tr>
       <tr><td>1. Which page was asked for the most?</td><td>The small NASA logo image
         (<code>${esc(r.topPages[0].path)}</code>), ${int(r.topPages[0].hits)} times. It appears on every page, so
         every visit loads it.</td></tr>
       <tr><td>2. At what hour do people visit the most?</td><td><strong>${hour(peak.hour)}</strong>, server time.
         Nights are quiet, and weekends are quieter than weekdays.</td></tr>
       <tr><td>3. How many visits failed?</td><td>404 "page not found": ${int(s404?.hits ?? 0)}
         (${pct(s404?.pct ?? 0, 2)}). 500 "server crashed": only ${int(s500?.hits ?? 0)}.</td></tr>
       <tr><td>4. Who visited the most?</td><td><code>${esc(r.topHosts[0].host)}</code>, ${int(r.topHosts[0].hits)}
         visits: an internet company's computer passing on visits from many of its customers.</td></tr>
       <tr><td>5. Is anything suspicious?</td><td>Spark raises alerts: traffic spikes, bursts of 404, server errors and a single
         visitor flooding the server.</td></tr>
       <tr><td>6. Do the two paths agree?</td><td>Yes, on every day: Hive's and Spark's totals are equal.</td></tr>
     </table>
     <h3 class="label-light">First: what is one line?</h3>
     <p>Each visit is one line. Read it like a receipt:</p>
     <pre class="code">199.72.81.55 - - [01/Jul/1995:00:00:01 -0400] "GET /history/apollo/ HTTP/1.0" 200 6245</pre>
     <table class="data compact">
       <tr><td><code>199.72.81.55</code></td><td><strong>Who</strong> visited: the visitor's computer address</td></tr>
       <tr><td><code>01/Jul/1995 00:00:01</code></td><td><strong>When</strong></td></tr>
       <tr><td><code>/history/apollo/</code></td><td><strong>What</strong> page they asked for</td></tr>
       <tr><td><code>200</code></td><td><strong>Result</strong>: 200 = OK, 404 = not found, 500 = server error</td></tr>
       <tr><td><code>6245</code></td><td><strong>Size</strong> of what was sent back, in bytes</td></tr>
     </table>`,
  );
}

function postOffice() {
  const rows: [string, string, string][] = [
    ["Replayer", "Someone dropping old letters into the mailbox, one by one", "Replays the 1995 lines as if visits were happening now"],
    ["Flume", "The postman who empties the mailbox", "Picks up each new line and stores it in HDFS"],
    ["Kafka", "The sorting centre's waiting room", "Holds structured copies of the lines, for two readers"],
    ["Kafka writer", "The truck driver", "Takes the copies from Kafka to the storage"],
    ["Spark", "The scoreboard operator", "Keeps a live tally per minute and raises alerts"],
    ["HDFS", "The giant archive, one shelf per day", "Stores all the lines, one folder per day"],
    ["Hive", "The analyst who reads the archive and counts", "Answers the questions with SQL"],
    ["YARN + MapReduce", "The team of workers the analyst directs", "Do the counting in parallel"],
    ["Sqoop", "The courier between archive and office", "Moves tables between HDFS and MySQL, both ways"],
    ["MySQL", "The office cabinet with the final reports", "Keeps the answers, ready to read"],
    ["Dashboard", "The TV screen in the lobby", "Shows the answers and the live activity"],
    ["Docker", "The building that contains all of it", "Runs everything on one laptop with one command"],
  ];
  return contentPage(
    "The big picture: a post office",
    `<p class="lead">Think of each log line as a <strong>letter</strong>. The project is a postal system that must
     deliver <strong>every letter</strong>, sort them by date, then study them.</p>
     <table class="data compact">
       <tr><th>Tool</th><th>In the post office picture</th><th>Its real job here</th></tr>
       ${rows.map(([tool, picture, job]) => `<tr><td><strong>${tool}</strong></td><td>${picture}</td><td>${job}</td></tr>`).join("")}
     </table>`,
  );
}

function toolsIngestion() {
  return toolsPage("Every tool: collecting the lines", 1, [
    {
      name: "Replayer",
      nickname: "the fake website",
      picture: "someone dropping old letters into the mailbox, one by one.",
      body: `<ul class="clean">
        <li>Our logs are from 1995. A small script reads the old lines and <strong>writes them again, one by
          one</strong>, into a new file (<code>access.log</code>), like real visits arriving.</li>
        <li><strong>Speed:</strong> you choose it: 500 lines per second by default, up to 20,000 from the website.</li>
        <li><strong>Safety:</strong> it writes down where it stopped, so nothing is skipped or written twice.</li></ul>`,
    },
    {
      name: "Flume",
      nickname: "the collector",
      picture: "the postman who empties the mailbox.",
      body: `<p>Flume is a tool made <strong>only to collect logs</strong>. You don't program it; you fill in a small
        settings file. The agent has three parts:</p>
        <ul class="clean">
        <li><strong>Source</strong>, where it takes lines from: it watches <code>access.log</code>.</li>
        <li><strong>Channel</strong>, its pocket: a file <strong>on disk</strong>, so a crash loses nothing.</li>
        <li><strong>Sink</strong>, where it sends lines: HDFS, straight into the <strong>day folder</strong>.</li>
        <li><strong>The clever trick:</strong> for each line it reads the <strong>date of the visit</strong> and sticks
          it on the line like a <strong>label</strong>. The label decides which day folder the line goes
          into: a visit from July 1st goes into <code>dt=1995-07-01</code>.</li></ul>`,
    },
    {
      name: "Kafka",
      nickname: "the waiting room",
      picture: "the sorting centre's waiting room.",
      body: `<ul class="clean">
        <li><strong>Why it's there:</strong> a Python producer reads the same visits and puts one structured
          message (JSON) per visit in line. If a reader is busy or broken, the messages
          <strong>wait safely</strong> instead of being lost.</li>
        <li>Messages are kept in a <strong>topic</strong>, a named queue: ours is <code>web-events</code>, cut into
          <strong>3 partitions</strong> (three lanes).</li>
        <li>Every message gets a <strong>ticket number</strong> (an <em>offset</em>). Each reader remembers its last
          ticket <strong>separately</strong>, so two readers can use the same topic.</li>
        <li><strong>Lag</strong> = messages waiting. 0 means everything is delivered. <strong>ZooKeeper</strong> is
          Kafka's small helper that keeps it organised.</li></ul>`,
    },
  ]);
}

function toolsStreaming() {
  return toolsPage("Every tool: the two readers of Kafka", 4, [
    {
      name: "Kafka HDFS writer",
      nickname: "the delivery truck",
      picture: "the truck driver.",
      body: `<ul class="clean">
        <li>Reads batches of messages, groups them by day, and stores them as JSON files in HDFS
          (<code>/data/nasa/streaming/kafka</code>).</li>
        <li>It <strong>publishes the file first and only then</strong> tells Kafka "done up to here". After a crash a
          batch may be written twice, never lost; Hive counts each message ID once.</li></ul>`,
    },
    {
      name: "Spark",
      nickname: "the scoreboard operator",
      picture: "the scoreboard operator who keeps a live tally and rings a bell.",
      body: `<ul class="clean">
        <li><strong>Spark Structured Streaming</strong> reads the same topic as the truck driver and, every
          <strong>5 seconds</strong>, counts visits, "not found", server errors and bytes <strong>per minute</strong>,
          and visits per computer per minute.</li>
        <li>It writes the tallies to HDFS (Parquet files, one folder per batch) and to MySQL, where the website's
          Real-time page reads them.</li>
        <li><strong>Alerts:</strong> 300 visits in a minute, 15 "not found", 3 server errors, or 30 visits from one
          computer.</li>
        <li><strong>Never counted twice:</strong> a replayed batch overwrites its own folder, and MySQL ignores a batch
          number it already added.</li>
        <li><strong>The check:</strong> at the end of the analysis, Spark's daily totals must equal Hive's, or the
          pipeline fails.</li></ul>`,
    },
  ]);
}

function toolsStorage(r: Report) {
  return toolsPage("Every tool: storing and counting", 6, [
    {
      name: "HDFS",
      nickname: "the giant archive",
      picture: "the giant archive, one shelf per day.",
      body: `<ul class="clean">
        <li><strong>HDFS = Hadoop Distributed File System</strong>: a hard drive spread over many computers. Big files
          are cut into <strong>blocks</strong>, and each block is copied onto several computers, so if one dies the
          copies survive.</li>
        <li>The <strong>NameNode</strong> is the librarian: it knows where every block is. The
          <strong>DataNodes</strong> are the shelves: they hold the blocks.</li>
        <li>We use <strong>one</strong> computer: the assignment allows it, and we say so as a deliberate choice.</li>
        <li>Several areas under <code>/data/nasa/</code>: <code>raw/flume/dt=…/</code> holds the raw lines
          (${bytes(r.hdfs.bytes)}), <code>streaming/kafka/</code> the JSON events, <code>streaming/spark/</code> the
          live tallies, <code>reference/</code> the code names from MySQL, <code>results/</code> the answers.</li></ul>`,
    },
    {
      name: "YARN and MapReduce",
      nickname: "the workers",
      picture: "the team of workers the analyst directs.",
      body: `<p>To count millions of lines fast, the work is split:</p>
        <ul class="clean">
        <li><strong>Map:</strong> each worker takes a pile of lines and notes one thing per line (for example the
          page).</li>
        <li><strong>Shuffle:</strong> all the notes about the same page go to the same worker.</li>
        <li><strong>Reduce:</strong> each worker adds up its notes: "logo: ${int(r.topPages[0].hits)}".</li>
        <li><strong>YARN</strong> is the boss who hands out the work. We never write this by hand: Hive writes it for
          us.</li></ul>`,
    },
  ]);
}

function toolsAnalysis(r: Report) {
  return toolsPage("Every tool: analysing", 8, [
    {
      name: "Hive",
      nickname: "SQL on the archive",
      picture: "the analyst who reads the archive and counts.",
      body: `<p>Hive lets you ask questions in <strong>SQL</strong>, the usual database language, and turns them into
        MapReduce work.</p>
        <ul class="clean">
        <li><strong>Step 1, describe the data</strong> (<code>hive/01_create_tables.sql</code>): "the files in
          <code>/data/weblogs</code> are a table". It is an <strong>external</strong> table: Hive reads the files where
          they are and never moves or deletes them.</li>
        <li>A <strong>regex</strong> (a text pattern) cuts each line into 7 boxes: who, identity, user, when, request,
          status, size. A line that doesn't fit gets empty boxes, and we <strong>count it</strong> as a bad line
          instead of hiding it: ${int(r.quality.malformed)} out of ${int(r.quality.total)}.</li>
        <li><strong>Step 2, compute the answers</strong> (<code>hive/02_analysis.sql</code>), six result tables:
          <code>top_pages</code> (question 1), <code>hits_per_hour</code> (2), <code>status_distribution</code> (3,
          with names like "Not Found"), <code>top_hosts</code> (4), <code>hits_per_day</code> (for the daily chart)
          and <code>data_quality</code> (good and bad lines).</li>
        <li><code>INSERT OVERWRITE</code>: running it again <strong>replaces</strong> the answers, it never doubles
          them.</li></ul>`,
    },
    {
      name: "Sqoop",
      nickname: "the courier between two worlds",
      picture: "the courier between the archive and the office.",
      body: `<p>On one side HDFS (big data), on the other MySQL (a normal database). Sqoop copies whole tables between
        them, <strong>in both directions</strong>, as the assignment asks:</p>
        <ul class="clean">
        <li><strong>Import, MySQL → HDFS:</strong> the small table <code>status_codes</code> (200 = "OK", 404 = "Not
          Found"…), so Hive can show names instead of bare numbers.</li>
        <li><strong>Export, HDFS → MySQL:</strong> the six answer tables.</li>
        <li><strong>A bug we fixed:</strong> Sqoop put the columns in <strong>alphabetical order</strong> instead of the
          table's order, so data landed in the wrong columns. We now always give it the exact column list.</li></ul>`,
    },
  ]);
}

function toolsDelivery() {
  return toolsPage("Every tool: reporting and running", 10, [
    {
      name: "MySQL",
      nickname: "the report cabinet",
      picture: "the office cabinet with the final reports.",
      body: `<ul class="clean">
        <li>A classic database, the kind companies use for reports.</li>
        <li>It holds the code-name table <code>status_codes</code>, the six answer tables and the speed tables Spark
          fills. The website reads its numbers from here.</li></ul>`,
    },
    {
      name: "Docker",
      nickname: "the building",
      picture: "the building that contains all of it.",
      body: `<ul class="clean">
        <li>Installing the tools by hand takes days and often breaks. Docker puts each program in a
          <strong>box</strong> (a <em>container</em>) with everything installed, and <strong>Docker Compose</strong>
          starts all the boxes with <strong>one command</strong>.</li>
        <li><strong>Separate boxes:</strong> <code>hadoop</code> (HDFS and YARN), <code>hive</code>,
          <code>kafka</code> with <code>zookeeper</code>, <code>mysql</code>, <code>flume-direct</code>,
          <code>kafka-producer</code> and <code>kafka-hdfs-writer</code>, <code>spark-streaming</code> (about 1 to 2 GB
          of memory), <code>replayer</code>, <code>client</code> (the toolbox for Hive and Sqoop commands, which also
          receives the website's button clicks) and <code>dashboard</code>.</li>
        </ul>`,
    },
    {
      name: "make",
      nickname: "the remote control in the terminal",
      picture: "the buttons on the wall of the building.",
      body: `<table class="data compact">
        <tr><th>Type this</th><th>It does</th></tr>
        <tr><td><code>make data</code></td><td>download the NASA files</td></tr>
        <tr><td><code>make build</code></td><td>prepare the boxes (first time only)</td></tr>
        <tr><td><code>make up</code></td><td>start everything</td></tr>
        <tr><td><code>make replay</code></td><td>play back the visits</td></tr>
        <tr><td><code>make speed-layer</code></td><td>see Spark's live tallies</td></tr>
        <tr><td><code>make counts</code></td><td>check that no line was lost</td></tr>
        <tr><td><code>make pipeline</code></td><td>Hive (with the speed check) and Sqoop: compute the answers and send them to MySQL</td></tr>
        <tr><td><code>make mysql</code></td><td>look at the answers</td></tr>
        <tr><td><code>make down</code> · <code>make clean</code></td><td>stop, keep the data · delete everything</td></tr>
      </table>`,
    },
  ]);
}

function journey() {
  const steps = [
    "The <strong>replayer</strong> writes the line into <code>access.log</code>.",
    "<strong>Flume</strong> sees it, reads its date (July 1, 1995), sticks on the label and writes it into the HDFS folder <code>dt=1995-07-01</code>.",
    "The <strong>producer</strong> turns the same visit into a JSON message with a stable ID and sends it to <strong>Kafka</strong>.",
    "Kafka confirms it is stored (<code>acks=all</code>).",
    "The <strong>writer</strong> takes it from Kafka and stores it in HDFS, then tells Kafka it is done.",
    "<strong>Spark</strong> reads the same message in its next 5-second batch and adds it to the tally of its minute.",
    "Spark writes the tally to MySQL (for the Real-time page) and to HDFS as Parquet.",
    "Sqoop reads the <code>status_codes</code> table from <strong>MySQL</strong> and copies it into HDFS.",
    "<strong>Hive</strong> reads the line, cuts it into boxes with its regex and adds the code name; the answers go to HDFS <code>results/</code>.",
    "Then Hive checks that Spark's totals for each day equal its own.",
    "<strong>Sqoop</strong> reads the answer files and exports the six tables into <strong>MySQL</strong>, where the website shows them.",
  ];
  return contentPage(
    "One line through the pipeline",
    `${figure("assets/log-line.png", "One log line, step by step: the same route as the list below.")}
     <ol class="steps">${steps.map((s) => `<li>${s}</li>`).join("")}</ol>`,
  );
}

function noLoss(r: Report) {
  return contentPage(
    "How do we know nothing is lost?",
    `<div class="kpis">
       <div class="kpi"><p class="value">${int(r.quality.total)}</p><p class="name">Lines sent</p></div>
       <div class="kpi"><p class="value">${int(r.quality.total)}</p><p class="name">Lines stored</p></div>
       <div class="kpi"><p class="value">${r.daily.length}</p><p class="name">Days of traffic</p></div>
       <div class="kpi"><p class="value">${int(r.quality.malformed)}</p><p class="name">Bad lines, counted</p></div>
     </div>
     <h3 class="label-light">The proof</h3>
     <p><code>make counts</code> compares two numbers: the lines the replayer wrote and the lines stored in HDFS. They
     are equal: ${int(r.quality.total)} = ${int(r.quality.total)}.</p>
     <h3 class="label-light">Why nothing gets lost</h3>
     <p>Each step <strong>remembers where it stopped</strong>, so a crash only means "continue from where you
     were":</p>
     <ul class="clean">
       <li>the replayer writes down its position in the old files;</li>
       <li>Flume writes down its position in <code>access.log</code>;</li>
       <li>the Flume pocket (channel) is a file on disk, not memory;</li>
       <li>Kafka confirms each message only once it is safely saved (<code>acks=all</code>);</li>
       <li>the Kafka writer stores a file first and only then tells Kafka its last ticket;</li>
       <li>Spark remembers its own position in a checkpoint, and never adds a batch twice.</li>
     </ul>
     <h3 class="label-light">Are the answers right?</h3>
     <p>Every answer was recounted with a separate program, straight from the original files and without Hadoop.
     Every number matches the tables in MySQL. And the two paths check each other: for every day, Spark's totals
     (from Kafka) equal Hive's totals (from Flume's lines).</p>
     ${optionalFigure("assets/screenshots/no-loss-check.png", "make counts after the full replay.")}`,
  );
}

function webOverview(r: Report) {
  return contentPage(
    "The website: the summary and the answers",
    `<p>Open <strong>http://localhost:3030</strong>. A menu on the left leads to five pages and to the native
     interfaces of HDFS, YARN and Hive.</p>
     <h3 class="label-light">Page 01, Overview: the summary</h3>
     <ul class="clean">
       <li><strong>Four big numbers:</strong> ${int(r.quality.total)} visits, ${r.daily.length} days, the share of
         errors, ${int(r.quality.malformed)} bad lines.</li>
       <li><strong>Pipeline right now:</strong> a row with every tool and a small light: green when working, grey when
         resting, red when broken.</li>
       <li><strong>Four cards</strong> with the answer to each question, and a chart of visits per day.</li>
     </ul>
     ${figure("assets/screenshots/dashboard-overview.png", "Page 01, Overview.")}
     <h3 class="label-light">Page 02, Analytics: the answers in detail</h3>
     <ul class="clean">
       <li>Most visited pages (top 10 with bars) · traffic per hour and per day · errors, with a ring chart and every
         code with its name (404 and 500 highlighted) · most active visitors (top 10) · data quality · then the two speed-layer questions: suspicious activity (Spark's alerts and the hosts that flood the most) and whether both layers agree, day by day.</li>
     </ul>`,
  );
}

function webLive() {
  return contentPage(
    "The website: the speed layer and the control room",
    `<h3 class="label-light">Page 03, Real-time</h3>
     <p>The speed layer's figures, read from the MySQL tables Spark fills: key numbers, traffic per minute, the alerts
     raised, and a table that compares the speed layer with the batch layer. It moves within seconds of the
     replay.</p>
     ${optionalFigure("assets/screenshots/dashboard-realtime.png", "Page 03, Real-time.")}
     <h3 class="label-light">Page 04, Live pipeline</h3>
     <ul class="clean">
       <li><strong>Buttons that replace the terminal:</strong> (1) <em>Start the three branches</em>, choosing the
         speed and how many lines; (2) <em>Run no-loss check</em> and <em>Check every branch</em>; (3)
         <em>Run batch pipeline</em>, all steps, or the small arrow for a single step. While something runs, a bar shows
         which step, for how long, and a <strong>Stop</strong> button.</li>
       <li><strong>Data flow:</strong> each tool is a card with its live number, from the MySQL source and the Sqoop import to the Sqoop export and the website; Kafka shows its two consumers.
         <strong>Moving dashes</strong> between cards mean data is flowing.</li>
       <li><strong>Throughput:</strong> lines per second at each step, and the Kafka <strong>lag</strong>.</li>
       <li><strong>Current run, console and MapReduce jobs:</strong> the steps with their durations, the live text
         output like a terminal, and the workers' tasks on YARN.</li>
     </ul>
     ${figure("assets/screenshots/dashboard-pipeline-parallel.png", "Page 04, Live pipeline: the data flow.")}
     <div class="panel"><p><strong>How do the buttons work?</strong> The website doesn't run Hadoop itself. When you
       click, it asks the <code>client</code> box: "please run <code>make pipeline</code>". The client runs the
       <strong>same scripts</strong> as the terminal and sends the text back to the console. Resource locks stop conflicting jobs; independent branches can work together.</p></div>`,
  );
}

function webExplore() {
  return contentPage("The website: explore",
    `<h3 class="label-light">Page 05, Data explorer</h3>
     <p>Look inside the HDFS folders: original logs, structured events, the speed layer's Parquet files, reference
     data and results. This is a way to see the files behind the charts.</p>
     ${figure("assets/screenshots/dashboard-explorer.png", "Page 05, Data explorer.")}`);
}

function words() {
  const glossary: [string, string][] = [
    ["Log", "A diary the server writes: one line per visit"],
    ["Pipeline", "A chain of steps the data goes through"],
    ["Near-real-time", "Handled a few seconds after it happens"],
    ["Batch", "Processed all at once, later"],
    ["Speed layer", "The fast path (Kafka, Spark): live figures, a few seconds behind"],
    ["Lambda architecture", "A batch layer for exact history plus a speed layer for fast answers"],
    ["Micro-batch", "A small group of messages Spark processes every few seconds"],
    ["Topic", "A named waiting line in Kafka"],
    ["Offset", "A line's ticket number in Kafka"],
    ["Lag", "How many lines are still waiting in Kafka"],
    ["Partition (Kafka)", "One lane of a topic"],
    ["Partition (HDFS, Hive)", "One folder, here one per day"],
    ["Regex", "A text pattern used to cut a line into pieces"],
    ["External table", "Hive reads the files where they are and doesn't own them"],
    ["Container", "A box with a program and everything it needs"],
  ];
  return contentPage(
    "Words to remember",
    `<table class="data">
       <tr><th>Word</th><th>Simple meaning</th></tr>
       ${glossary.map(([w, m]) => `<tr><td><strong>${w}</strong></td><td>${m}</td></tr>`).join("")}
     </table>`,
  );
}

function questions(r: Report) {
  const all: [string, string][] = [
    ["Why Kafka?", "It is a durable waiting room read by two independent readers: the HDFS writer and Spark. If one stops, messages wait in Kafka and nothing is lost."],
    ["Why Spark, and why not only Hive?", "Hive is exact but only after the run. Spark gives per-minute traffic and alerts within seconds. We keep both and check that they agree."],
    ["How do you avoid counting a minute twice?", "Each 5-second batch has its own number: its HDFS folder is overwritten if replayed, and MySQL skips a batch number it already added."],
    ["Why one folder per day?", "A question about one day only reads that day's folder, which is faster. And it's tidy."],
    ["Why use the visit date and not today's date?", "We replay 1995 data. Without the label, everything would land in today's folder."],
    ["How do you prove no data was lost?", `make counts: ${int(r.quality.total)} sent = ${int(r.quality.total)} stored.`],
    ["What happens to broken lines?", `They are kept and counted (${int(r.quality.malformed)}), never silently deleted.`],
    ["Why Sqoop in both directions?", "Import: bring the code names from MySQL. Export: send the answers to MySQL for reports."],
    ["Why only one computer?", "The assignment allows it on a laptop. The same setup works on many computers by adding DataNodes and Kafka brokers."],
    ["Why Docker instead of a virtual machine?", "One command, the same result on every machine, easy for the team."],
  ];
  const block = (items: [string, string][]) => items.map(([q, a]) => `<div class="qa"><p class="q">${q}</p><p class="a">${a}</p></div>`).join("");
  const half = Math.ceil(all.length / 2);
  return contentPage("Questions the teacher may ask", block(all.slice(0, half)))
    + contentPage("Questions the teacher may ask (continued)", block(all.slice(half)));
}

function closing(r: Report) {
  return page(
    `<p class="brand label-light">${esc(r.meta.institution)}</p>
     <p class="date">${esc(r.meta.date)}</p>
     <div class="thanks"><h1 class="display">Thank you</h1><p>${r.meta.authors.map(esc).join(" · ")}</p></div>`,
    { cream: true, className: "closing" },
  );
}

export async function guideHtml(r: Report): Promise<string> {
  const pages = [
    cover(r), contents(r.meta.institution),
    divider(0), story(r), postOffice(), twoWays(), whySpeed(),
    divider(1), toolsIngestion(), toolsStreaming(), toolsStorage(r), toolsAnalysis(r), toolsDelivery(),
    divider(2), journey(), noLoss(r),
    divider(3), webOverview(r), webLive(), webExplore(),
    divider(4), words(), questions(r),
    closing(r),
  ];
  return htmlDocument(`${r.meta.title}: explained simply`, ["report/report.css", "guide/guide.css"], pages.join("\n"));
}
