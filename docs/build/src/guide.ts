// "The project, explained simply": a plain-language guide to the whole project, in the report's
// template (same cover, dividers, bars and fonts), for readers who know none of the tools.
import type { Report } from "./data.ts";
import { bytes, esc, hour, int, pct } from "./format.ts";
import { htmlDocument } from "./layout.ts";
import { createPages, figure } from "./pages.ts";

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
     <h3 class="label-light">The four questions we answer</h3>
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
    ["Flume agent 1", "The postman who empties the mailbox", "Picks up each new line and sends it on"],
    ["Kafka", "The sorting centre's waiting room", "Holds the lines safely until the next step is ready"],
    ["Kafka HDFS writer", "The truck driver", "Takes the lines from Kafka to the storage"],
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
     <table class="data">
       <tr><th>Tool</th><th>In the post office picture</th><th>Its real job here</th></tr>
       ${rows.map(([tool, picture, job]) => `<tr><td><strong>${tool}</strong></td><td>${picture}</td><td>${job}</td></tr>`).join("")}
     </table>
     ${figure("assets/architecture.png", "The real pipeline. Top row: lines arrive continuously. Bottom row: batch analysis. Dashed arrows: the status_codes table imported by Sqoop.")}`,
  );
}

function toolsIngestion() {
  return toolsPage("Every tool: collecting the lines", 1, [
    {
      name: "Replayer",
      nickname: "the fake website",
      picture: "someone dropping old letters into the mailbox, one by one.",
      body: `<ul class="clean">
        <li><strong>Problem:</strong> our logs are from 1995. Nobody visits that site any more.</li>
        <li><strong>Solution:</strong> a small script reads the old lines and <strong>writes them again, one by
          one</strong>, into a new file (<code>access.log</code>), like real visits arriving.</li>
        <li><strong>Speed:</strong> you choose it: 500 lines per second by default, up to 10,000 from the website.</li>
        <li><strong>Safety:</strong> it writes down where it stopped. If it stops, it continues from the same place:
          nothing is skipped and nothing is written twice.</li></ul>`,
    },
    {
      name: "Flume agent 1",
      nickname: "the collector",
      picture: "the postman who empties the mailbox.",
      body: `<p>Flume is a tool made <strong>only to collect logs</strong>. You don't program it; you fill in a small
        settings file. Every agent has three parts:</p>
        <ul class="clean">
        <li><strong>Source</strong>, where it takes lines from: it watches <code>access.log</code>.</li>
        <li><strong>Channel</strong>, its pocket: a file <strong>on disk</strong>, so a crash loses nothing.</li>
        <li><strong>Sink</strong>, where it sends lines: the canonical raw zone in HDFS.</li>
        <li><strong>The clever trick:</strong> for each line it reads the <strong>date of the visit</strong> and sticks
          it on the line like a <strong>label</strong>. Later, that label decides which day folder the line goes
          into.</li></ul>`,
    },
    {
      name: "Kafka",
      nickname: "the waiting room",
      picture: "the sorting centre's waiting room.",
      body: `<ul class="clean">
        <li><strong>Why it's there:</strong> if the storage is busy or broken for five minutes, the lines
          <strong>wait safely in line</strong> instead of being lost.</li>
        <li>Lines are kept in a <strong>topic</strong>, a named queue: ours is <code>web-logs</code>, cut into
          <strong>3 partitions</strong> (three lanes, so the work goes faster).</li>
        <li>Every line gets a <strong>ticket number</strong> (an <em>offset</em>). The reader remembers the last ticket
          it handled.</li>
        <li><strong>Lag</strong> = lines waiting = last ticket in Kafka minus last ticket read. 0 means everything is
          delivered.</li>
        <li><strong>ZooKeeper</strong> is Kafka's small helper that keeps it organised.</li></ul>`,
    },
  ]);
}

function toolsStorage(r: Report) {
  return toolsPage("Every tool: storing and counting", 4, [
    {
      name: "Kafka HDFS writer",
      nickname: "the delivery truck",
      picture: "the truck driver.",
      body: `<ul class="clean">
        <li>A dedicated Python consumer reads independently produced JSON from Kafka and writes closed HDFS batches before committing offsets.</li>
        <li>It reads each line's date label and drops the line in the right <strong>day folder</strong>: a visit from
          July 1st goes into <code>dt=1995-07-01</code>.</li>
        <li><strong>The one special case:</strong> one line in the whole dataset has no date (it is cut off at the end
          of the July file). Instead of throwing it away, Flume files it under dt=1970-01-01 and Kafka uses dt=unknown. That's why there are
          ${r.hdfs.partitions} folders: ${r.daily.length} real days plus one.</li></ul>`,
    },
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
        <li>Three areas: <code>/data/nasa/raw/flume/dt=…/</code> holds the raw lines (${bytes(r.hdfs.bytes)}),
          <code>/data/nasa/reference/sqoop/status_codes/</code> the code names from MySQL, <code>/data/results/</code> the
          answers.</li></ul>`,
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
  return toolsPage("Every tool: analysing", 7, [
    {
      name: "Hive",
      nickname: "SQL on the archive",
      picture: "the analyst who reads the archive and counts.",
      body: `<p>Hive lets you ask questions in <strong>SQL</strong>, the usual database language, and turns them into
        MapReduce work.</p>
        <ul class="clean">
        <li><strong>Step 1, describe the data</strong> (<code>hive/01_create_tables.sql</code>): "the files in
          <code>/data/nasa/raw/flume</code> are a table". It is an <strong>external</strong> table: Hive reads the files where
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
  return toolsPage("Every tool: reporting and running", 9, [
    {
      name: "MySQL",
      nickname: "the report cabinet",
      picture: "the office cabinet with the final reports.",
      body: `<ul class="clean">
        <li>A classic database, the kind companies use for reports.</li>
        <li>It holds the code-name table <code>status_codes</code> and the six answer tables. The website reads its
          numbers from here.</li></ul>`,
    },
    {
      name: "Docker",
      nickname: "the building",
      picture: "the building that contains all of it.",
      body: `<ul class="clean">
        <li>Installing Hadoop, Hive, Kafka, Flume and Sqoop by hand takes days and often breaks. Docker puts each
          program in a <strong>box</strong> (a <em>container</em>) that already has everything installed, and
          <strong>Docker Compose</strong> starts all the boxes with <strong>one command</strong>.</li>
        <li><strong>Eleven boxes:</strong> <code>hadoop</code> (HDFS and YARN), <code>hive</code>,
          <code>zookeeper</code> and <code>kafka</code>, <code>kafka-init</code> (creates the topic, then stops),
          <code>mysql</code>, <code>flume-agent1</code> and <code>kafka-hdfs-writer</code>, <code>replayer</code> (replays
          the logs, then stops), <code>client</code> (the toolbox where Hive and Sqoop commands run; it also receives
          the website's button clicks) and <code>dashboard</code> (the website).</li>
        <li>Your colleague runs exactly the same thing on any computer.</li></ul>`,
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
        <tr><td><code>make counts</code></td><td>check that no line was lost</td></tr>
        <tr><td><code>make pipeline</code></td><td>Hive and Sqoop: compute the answers and send them to MySQL</td></tr>
        <tr><td><code>make mysql</code></td><td>look at the answers</td></tr>
        <tr><td><code>make down</code> · <code>make clean</code></td><td>stop and keep the data · stop and delete
          everything</td></tr>
      </table>`,
    },
  ]);
}

function journey() {
  const steps = [
    "The <strong>replayer</strong> writes the line into <code>access.log</code>.",
    "<strong>Flume 1</strong> sees it, reads its date (July 1, 1995), sticks on the label and writes it directly to HDFS. A separate producer sends a structured representation to Kafka.",
    "<strong>Kafka writer</strong> takes it from <strong>Kafka</strong>, where it waited with its ticket number.",
    "Kafka writer puts it in the HDFS folder <code>dt=1995-07-01</code>. Then <code>make counts</code> checks: lines sent = lines stored.",
    "Sqoop reads the <code>status_codes</code> table from <strong>MySQL</strong>…",
    "…and copies it into HDFS, <code>/data/nasa/reference/sqoop/</code>.",
    "<strong>Hive</strong> reads the line, cuts it into boxes with its regex and adds the code name.",
    "Hive writes the answers into HDFS, <code>/data/results/</code>.",
    "<strong>Sqoop</strong> reads those answer files…",
    "…and exports the six tables into <strong>MySQL</strong>, where the website shows them.",
  ];
  return contentPage(
    "The journey of one line",
    `${figure("assets/log-line.png", "One log line, step by step. The numbers match the list below.")}
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
     <h3 class="label-light">Recovery and reconciliation</h3>
     <p>Each step <strong>remembers where it stopped</strong>, so a crash only means "continue from where you
     were":</p>
     <ul class="clean">
       <li>the replayer writes down its position in the old files;</li>
       <li>Flume 1 writes down its position in <code>access.log</code>;</li>
       <li>the Flume pockets (channels) are files on disk, not memory;</li>
       <li>Kafka confirms each line only once it is safely saved (<code>acks=all</code>);</li>
       <li>Kafka writer remembers its last Kafka ticket.</li>
     </ul>
     <h3 class="label-light">Are the answers right?</h3>
     <p>Run verify-ingestion and verify-analytics after a complete replay. These compare actual persisted data and reporting results with source identities and the historical baseline. Checkpoints alone do not prove no loss or no duplicates.</p>
     ${figure("assets/screenshots/terminal-counts.png", "make counts after the full replay.")}`,
  );
}

function webOverview(r: Report) {
  return contentPage(
    "The website: the summary and the answers",
    `<p>Open <strong>http://localhost:3030</strong>. A menu on the left leads to three pages and to the native
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
         code with its name (404 and 500 highlighted) · most active visitors (top 10) · data quality.</li>
     </ul>`,
  );
}

function webLive() {
  return contentPage(
    "The website: the control room",
    `<h3 class="label-light">Page 03, Live pipeline</h3>
     <ul class="clean">
       <li><strong>Buttons that replace the terminal:</strong> (1) <em>Replay the logs</em>, choosing the speed and how
         many lines; (2) <em>Run no-loss check</em>; (3) <em>Run batch pipeline</em>, all four steps, or the small
         arrow for a single step. While something runs, a blue bar shows which step, for how long, and a
         <strong>Stop</strong> button.</li>
       <li><strong>Data flow:</strong> each tool is a card with its live number. <strong>Moving dashes</strong> between
         cards mean data is flowing, faster when more data flows.</li>
       <li><strong>Throughput:</strong> lines per second at each step while lines are flowing, and the Kafka
         <strong>lag</strong> (lines waiting).</li>
       <li><strong>Current run:</strong> the steps with a tick, a spinner or a cross, and their durations.</li>
       <li><strong>Console:</strong> the live text output, like a terminal; its corner button makes it full screen,
         Esc closes it.</li>
       <li><strong>MapReduce jobs:</strong> the workers' tasks on YARN, with progress bars.</li>
     </ul>
     ${figure("assets/screenshots/dashboard-run.png", "Page 03, Live pipeline, while the Hive analysis runs.", "tall")}
     <div class="panel"><p><strong>How do the buttons work?</strong> The website doesn't run Hadoop itself. When you
       click, it asks the <code>client</code> box: "please run <code>make pipeline</code>". The client runs the
       <strong>same scripts</strong> as the terminal and sends the text back to the console. Only one job runs at a
       time, so nothing can collide.</p></div>`,
  );
}

function words() {
  const glossary: [string, string][] = [
    ["Log", "A diary the server writes: one line per visit"],
    ["Pipeline", "A chain of steps the data goes through"],
    ["Near-real-time", "Handled a few seconds after it happens"],
    ["Batch", "Processed all at once, later"],
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
  const qa: [string, string][] = [
    ["Why a separate Kafka branch?", "An independent producer publishes JSON events. Kafka buffers them while the dedicated HDFS writer is unavailable. Verify logical IDs after recovery; duplicates are possible."],
    ["Why one folder per day?", "A question about one day only reads that day's folder, which is faster. And it's tidy."],
    ["Why use the visit date and not today's date?", "We replay 1995 data. Without the label, everything would land in today's folder."],
    ["How do you prove no data was lost?", `make counts: ${int(r.quality.total)} sent = ${int(r.quality.total)} stored.`],
    ["What happens to broken lines?", `They are kept and counted (${int(r.quality.malformed)}), never silently deleted.`],
    ["Why Sqoop in both directions?", "Import: bring the code names from MySQL. Export: send the answers to MySQL for reports."],
    ["Why only one computer?", "The assignment allows it on a laptop. The same setup works on many computers by adding DataNodes and Kafka brokers."],
    ["Why Docker instead of a virtual machine?", "One command, the same result on every machine, easy for the team."],
  ];
  return contentPage(
    "Questions the teacher may ask",
    qa.map(([q, a]) => `<div class="qa"><p class="q">${q}</p><p class="a">${a}</p></div>`).join(""),
  );
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
    divider(0), story(r), postOffice(),
    divider(1), toolsIngestion(), toolsStorage(r), toolsAnalysis(r), toolsDelivery(),
    divider(2), journey(), noLoss(r),
    divider(3), webOverview(r), webLive(),
    divider(4), words(), questions(r),
    closing(r),
  ];
  return htmlDocument(`${r.meta.title}: explained simply`, ["report/report.css", "guide/guide.css"], pages.join("\n"));
}
