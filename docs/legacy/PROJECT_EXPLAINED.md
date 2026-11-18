# The Web Traffic Pipeline, Explained From Zero

This document explains the whole project to someone who has never touched a big data tool. Read it top to bottom once; after that, use the glossary and the exam questions at the end as a reference.

---

## 1. What this project is

We took the real access logs of the NASA Kennedy Space Center web server for July and August 1995, about 3.46 million lines, and built a small but complete big data pipeline around them. A script replays the old logs as if the website were live. Flume collects the lines, Kafka buffers them, a second Flume agent stores them in HDFS, Hive runs SQL over them, and Sqoop copies the results into MySQL, where a web dashboard shows them. Everything runs in Docker containers on one laptop and starts with one command.

The pipeline answers four questions:

1. What are the 10 most visited pages?
2. How is traffic distributed over the hours of the day?
3. What share of requests end in errors (404, 500, ...)?
4. Who are the 10 most active client hosts?

---

## 2. Zero-knowledge basics

### 2.1 What a web server log line is

Every time a browser asks a web server for something (a page, an image, a file), the server writes one line into a log file. Here is a real line from our data:

```
199.72.81.55 - - [01/Jul/1995:00:00:01 -0400] "GET /history/apollo/ HTTP/1.0" 200 6245
```

This format is called the **Common Log Format**. Field by field:

| Part | Value | Meaning |
|------|-------|---------|
| host | `199.72.81.55` | Who asked: an IP address or a machine name |
| ident | `-` | An old identity field, almost always empty (`-`) |
| authuser | `-` | The logged-in user name, empty for public pages |
| time | `[01/Jul/1995:00:00:01 -0400]` | When: 1 July 1995, one second after midnight, server time 4 hours behind UTC |
| request | `"GET /history/apollo/ HTTP/1.0"` | What: method `GET` (read), path `/history/apollo/`, protocol version |
| status | `200` | How it went (see below) |
| bytes | `6245` | Size of the answer in bytes (`-` when nothing was sent) |

The **status code** is a three-digit number. The first digit tells you the family:

| Family | Meaning | Examples |
|--------|---------|----------|
| 2xx | Success | `200 OK` |
| 3xx | Redirection, "look elsewhere" | `302 Found` (moved), `304 Not Modified` (your cached copy is still good) |
| 4xx | Client error, the request was wrong | `400 Bad Request`, `403 Forbidden`, `404 Not Found` |
| 5xx | Server error, the server failed | `500 Internal Server Error`, `501 Not Implemented` |

A simple way to remember it: 2 is "here you go", 3 is "go over there", 4 is "your fault", 5 is "my fault".

### 2.2 What "big data" means

"Big data" is not a magic size. It means: **the data is too big, arrives too fast, or is too varied for one ordinary program on one ordinary machine.** The answer is to spread the storage and the work across many machines, and to build tools that survive when one of those machines fails.

Honestly, 3.46 million lines (about 200 MB of text) would fit on a laptop, and a short Python script could count them in seconds. That is not the point. The point is to learn the tools and the architecture that a company uses when it has billions of lines per day. Our pipeline is built exactly as it would be on a real cluster; it just runs on one machine.

An analogy: learning to fly on a small training plane. The plane is tiny, but the controls, the checklists and the procedures are the real ones.

### 2.3 Batch versus near-real-time

| Mode | Idea | In our project |
|------|------|----------------|
| Batch | Collect a lot of data, then process it all at once, later | Hive queries over all the stored days |
| Near-real-time (streaming) | Process data continuously, a few seconds after it appears | Flume and Kafka moving each line as it is written |

Batch is like doing the laundry once a week; streaming is like washing each dish right after you use it. Our project does both: lines flow in continuously, and the analysis runs in batch on top.

---

## 3. The tools

The big picture first:

```
NASA .gz files
     │
     ▼
 replayer ──► access.log ──► Flume agent 1 ──► Kafka topic "web-logs" ──► Flume agent 2
                             (TAILDIR → Kafka)     (3 partitions)          (Kafka → HDFS)
                                                                                 │
                                                                                 ▼
 dashboard ◄── MySQL ◄── Sqoop export ◄── Hive result tables ◄── Hive ◄── HDFS /data/weblogs/dt=YYYY-MM-DD
                 │                              ▲
                 └── status_codes ── Sqoop import ┘
```

### 3.1 HDFS: the warehouse

**HDFS** (Hadoop Distributed File System) stores very large files across many machines as if they were one disk.

- A file is cut into **blocks** (128 MB each by default). Each block is a separate piece that can live on a different machine.
- The **DataNodes** are the shelves: they hold the actual blocks.
- The **NameNode** is the catalogue at the front desk: it knows which blocks make up which file and on which DataNode each block lives. It does not hold the data itself.
- **Replication** means each block is copied to several DataNodes (3 by default), so losing one machine loses nothing.

Our cluster has a single DataNode, so the replication factor is **1**. A second copy on the same disk would protect against nothing. On a real cluster you would keep 3.

Our raw logs live under `/data/weblogs/`, one folder per day, for example `/data/weblogs/dt=1995-07-01/`. You can browse HDFS at http://localhost:9870.

### 3.2 YARN and MapReduce: the workers and the method

**YARN** is the cluster's job manager. The **ResourceManager** decides which job gets how much memory and CPU; each machine runs a **NodeManager** that starts the actual work in "containers" (small reserved slices of memory and CPU, not to be confused with Docker containers). Our NodeManager offers 4 GB and 4 cores. You can watch jobs at http://localhost:8088.

**MapReduce** is the method used to process data in parallel. Imagine counting the votes of a whole country:

1. **Map**: every polling station counts its own ballots and writes small notes like `(candidate A, 1)`. In our case, each piece of the logs produces `(path, 1)` for every line.
2. **Shuffle**: all notes about the same candidate are sent to the same counting desk. This is the sorting and moving step.
3. **Reduce**: each desk adds up its notes and announces `(candidate A, 1,204,331)`.

Because map works on each block separately, a thousand machines can map a thousand blocks at the same time.

**Why Hive queries take minutes even on small data:** each MapReduce job has a fixed startup cost. YARN must allocate containers, start a Java virtual machine for each task, read from HDFS, write intermediate results to disk, shuffle, and write the output back. That overhead is tens of seconds per job, and one Hive query can be several jobs in a row. On billions of lines this overhead is negligible; on 3.46 million lines it is most of the time. It is like hiring a moving truck to carry one box: the truck is not slow, the booking and loading are.

### 3.3 Kafka: the waiting room

**Kafka** is a durable message queue. Producers write messages; consumers read them, at their own pace.

| Concept | Meaning | In our project |
|---------|---------|----------------|
| Topic | A named stream of messages, like a TV channel | `web-logs` |
| Partition | A topic is split into ordered pieces so several readers can work in parallel | 3 partitions |
| Offset | The position number of a message inside a partition, like a page number | Each log line gets one |
| Consumer group | A team of readers sharing the work; Kafka remembers how far the team got | `flume-hdfs-writer` (Flume agent 2) |
| Lag | How many messages are waiting, not yet read by the group | Grows when agent 2 is stopped, shrinks when it catches up |
| Broker | A Kafka server | One broker |

Messages are not deleted when read. They stay on disk for a retention period, and each consumer group keeps its own bookmark (the committed offset). That is why a reader can stop, restart and continue exactly where it left off.

**ZooKeeper** is Kafka's coordinator in our version (Confluent Platform 7.6.1). It keeps track of which brokers are alive and holds cluster metadata. Think of it as the building manager who knows which rooms exist and who is inside. Newer Kafka versions can run without it, but ours uses it.

### 3.4 Flume: the postman

**Flume** moves log data from one place to another with configuration instead of code. A running Flume process is an **agent**, and every agent has three parts:

```
  source  ──►  channel  ──►  sink
 (picks up)   (holds)      (delivers)
```

- **Source**: where events come in.
- **Channel**: a buffer between source and sink. A **file channel** keeps the buffer on disk, so events survive a crash; a memory channel would be faster but would lose them.
- **Sink**: where events go out.

An **event** is one log line (the body) plus a few key-value **headers**. **Interceptors** are small filters that can read or change an event as it enters the agent, for example to add a header.

We run two agents:

| Agent | Source | Channel | Sink |
|-------|--------|---------|------|
| agent 1 | **TAILDIR**: follows `/data/live/access.log` like `tail -f`, and remembers its position in a JSON file | file channel | **Kafka sink**: publishes to topic `web-logs`, waits for `acks=all` |
| agent 2 | **Kafka source**: reads `web-logs` as group `flume-hdfs-writer` | file channel | **HDFS sink**: writes to `/data/weblogs/dt=%Y-%m-%d` |

Two interceptors matter:

- On agent 1, a **regex_extractor** interceptor reads the date inside the line (`01/Jul/1995:00:00:01`) and stores it as the `timestamp` header, in milliseconds.
- On agent 2, a **timestamp** interceptor with `preserveExisting = true` adds the current time only to events that have no timestamp yet. Those are the lines agent 1 could not parse.

Files being written in HDFS start with `_`, so Hive never reads a half-written file. A file is closed every 5 minutes, at 128 MB, or after 60 seconds of inactivity.

### 3.5 Hive: SQL on top of files

**Hive** lets you write SQL against files in HDFS. It translates each query into MapReduce jobs.

- **Metastore**: Hive has to remember that "table `access_logs_raw` = these files, with these columns". That description (the metadata) is stored in a MySQL database. The data itself stays in HDFS.
- **External table**: Hive only points at a folder; it does not own the files. Dropping the table leaves the files untouched. This is right for us, because Flume owns and writes those files.
- **SerDe** (Serializer/Deserializer): the piece that turns a line of text into columns. We use **RegexSerDe**: a regular expression with seven groups (host, ident, authuser, time, request, status, bytes). A line that does not match becomes a row of NULLs instead of crashing the query.
- **Partitions**: the table is split by a column `dt`, matching the folders `dt=1995-07-01`, `dt=1995-07-02`, and so on. A query about one day reads only that folder. It is like a filing cabinet with one drawer per day.
- **MSCK REPAIR TABLE**: Flume creates new day folders on its own, and Hive does not notice them. This command scans the table's folder and registers any new partitions.
- **View**: `access_logs` is a saved query on top of `access_logs_raw`. It keeps only well-formed lines and turns text into typed columns (`hour_of_day`, `method`, `path`, `status` as a number, bytes with `-` read as 0).

The analysis writes six result tables: `top_pages`, `hits_per_hour`, `hits_per_day`, `status_distribution`, `top_hosts` and `data_quality`.

### 3.6 Sqoop: the delivery truck

**Sqoop** copies data between a relational database and HDFS, in both directions. Each transfer runs as a MapReduce job (we use one mapper, `-m 1`, because the tables are small).

- **Import** (MySQL → HDFS): the small `status_codes` table ("404 = Not Found, Client Error") goes to `/data/reference/status_codes`, so Hive can join it with the logs.
- **Export** (HDFS → MySQL): each result table is emptied in MySQL (`TRUNCATE`), then reloaded from its HDFS folder.

### 3.7 MySQL: the reporting desk

**MySQL** 8.0 plays three roles: it stores the reference table `status_codes`, the final results (database `weblogs`), and Hive's metastore. MySQL is what a business analyst or a website would actually query: fast for small answers, unlike Hive.

### 3.8 Docker: the shipping containers

Installing Java, Hadoop, Hive, Kafka, ZooKeeper, Flume, Sqoop and MySQL by hand takes hours and breaks easily. Docker packages them.

| Concept | Meaning | Analogy |
|---------|---------|---------|
| Image | A frozen, ready-to-run template of a system | A recipe, or a cake mould |
| Container | A running instance of an image | One cake baked from the mould |
| Volume | Storage that survives when a container is deleted | A fridge where you keep leftovers |
| Docker Compose | One file (`docker-compose.yml`) describing every container, its ports, volumes and start order | The seating plan for a dinner party |

**Our trick: one image, many roles.** Hadoop, Hive, Flume and Sqoop all need the same Hadoop libraries. Instead of four images, we built one image, `weblogs/bigdata`, with Hadoop 3.3.6, Hive 3.1.3, Flume 1.9.0 and Sqoop 1.4.7. The `entrypoint.sh` script reads the first argument (`hadoop`, `hive`, `flume`, `replayer` or `client`) and runs the matching script in `roles/`. Same toolbox, different job.

Our containers:

| Container | Role |
|-----------|------|
| `mysql` | Database (results, reference data, Hive metastore) |
| `zookeeper`, `kafka` | Message queue and its coordinator |
| `kafka-init` | Runs once to create topic `web-logs` with 3 partitions |
| `hadoop` | HDFS (NameNode + DataNode) and YARN (ResourceManager + NodeManager) and job history |
| `hive` | Metastore service and HiveServer2 |
| `flume-agent1`, `flume-agent2` | The two postmen |
| `replayer` | Simulates live traffic (started only by `make replay`) |
| `client` | Toolbox for running Hive scripts, Sqoop and checks |

### 3.9 The web dashboard

The `dashboard/` folder holds a Next.js web application, served at http://localhost:3030. It is the shop window of the project. It reads the final results from MySQL, and shows the live state of the pipeline: Kafka (topic and consumer lag), HDFS (day partitions), YARN (jobs) and the Flume agents' metrics (each agent exposes counters over HTTP, port 34545 by default, such as events received and delivered).

It can also **run the pipeline**. The buttons on the *Live pipeline* page do not run anything inside the dashboard itself: they ask a small **control API** (`scripts/control_server.py`) to do it. That API runs in the `client` container, which already has Hadoop, Hive and Sqoop installed, and it runs exactly the scripts the `make` targets run. It allows one job at a time, keeps the output of each job so the page can show it line by line, and can stop a job. It listens only on the private Docker network; the dashboard is the only thing that talks to it, and the dashboard only accepts these requests from its own pages.

Think of it as a remote control: the dashboard is the remote, the client container is the machine, and the buttons press the same keys you would press in a terminal.

---

## 4. Follow one line

Let us follow our example line, `199.72.81.55 - - [01/Jul/1995:00:00:01 -0400] "GET /history/apollo/ HTTP/1.0" 200 6245`, from start to finish.

1. **In the archive.** It sits inside `data/raw/NASA_access_log_Jul95.gz`, a compressed file downloaded by `make data`.
2. **Replayed.** `scripts/replay.py` reads the `.gz` files in calendar order (July before August) and appends lines to `/data/live/access.log` at `REPLAY_RATE` lines per second (500 by default). After each batch it saves its position in a state file, so a restart continues at exactly the next line.
3. **Picked up by Flume agent 1.** The TAILDIR source notices the new line in `access.log` and turns it into an event.
4. **Timestamped.** The `regex_extractor` interceptor finds `01/Jul/1995:00:00:01` in the line and adds the header `timestamp = <that moment in milliseconds>`. The event goes into the file channel on disk.
5. **Into Kafka.** The Kafka sink publishes the event to topic `web-logs`. With `useFlumeEventFormat = true`, the headers travel with the body, so the timestamp is not lost. With `acks = all`, the sink only considers the message sent once Kafka confirms it is stored. The line lands in one of the 3 partitions and gets an offset.
6. **Read by Flume agent 2.** The Kafka source, in consumer group `flume-hdfs-writer`, reads the event and unpacks the headers. The fallback interceptor sees a timestamp already there and leaves it alone. The event goes into agent 2's file channel. The offset is committed so Kafka knows this line is done.
7. **Written to HDFS.** The HDFS sink reads the timestamp header, fills `dt=%Y-%m-%d` with `1995-07-01`, and appends the line to a file in `/data/weblogs/dt=1995-07-01/`. The file is named `_weblogs...` while open, then renamed `weblogs...` when closed.
8. **Seen by Hive.** `MSCK REPAIR TABLE` registers the partition `dt=1995-07-01`. RegexSerDe splits the line into seven columns; the view `access_logs` turns it into `host = 199.72.81.55`, `hour_of_day = 0`, `method = GET`, `path = /history/apollo/`, `status = 200`, `bytes = 6245`.
9. **Counted.** The queries in `hive/02_analysis.sql` count it once in `hits_per_hour` (hour 0), once for status 200 in `status_distribution` (labelled "OK" thanks to the imported `status_codes`), once for its host, and once for 1 July in `hits_per_day`. Results are written to `/data/results/...` in HDFS.
10. **Exported.** `sqoop/export_results.sh` empties each MySQL result table and reloads it from HDFS.
11. **Shown.** The dashboard queries MySQL and draws the charts. Our line is now one tiny part of the bar for midnight.

---

## 5. Design decisions and why

### Partition by event date, not ingestion date

If agent 2 used the current time, all 1995 data replayed today would land in one folder named after today, and "traffic on 1 July 1995" would be meaningless. By carrying the real request time from agent 1 to agent 2 in a header, each line goes to the folder of the day it actually happened. It is like filing a letter by the date written on it, not by the day it arrived in the mailroom.

### No data loss

Every stage is designed to survive a stop:

| Risk | Protection |
|------|------------|
| Flume agent crashes with events in its buffer | File channels keep the buffer on disk |
| Kafka loses a message it said it had | Producer waits for `acks = all` |
| Agent 2 is stopped | Messages wait in Kafka; on restart it resumes from its committed offset |
| Agent 1 restarts | TAILDIR position file remembers where it stopped in `access.log` |
| Replayer restarts | State file holds its offset, so no line is skipped or duplicated |

And we do not just trust it: `make counts` (`scripts/check-counts.sh`) compares the number of lines replayed with the number of lines in HDFS.

### Malformed lines are kept and counted

Most malformed lines still contain a valid date (for example a request with a broken quote), so agent 1 timestamps them and they land in the right day folder. A line without any date gets no timestamp from agent 1; instead of dropping it, agent 2's fallback interceptor gives it the current time, so it lands in today's partition. In the full dataset this happens to exactly one line, `alyssa.p`: the last line of the July file, cut off and without a final newline. In Hive the regex does not match any malformed line, the row is all NULLs, the view skips it, and the `data_quality` table counts it. Bad data is measured, not hidden.

### Decoupled containers

Each service runs in its own container. One can be stopped, restarted or upgraded without touching the others, and Kafka in the middle means the collector and the writer never have to run at the same speed.

### Single node as a deliberate limit

HDFS and YARN run "pseudo-distributed": all daemons in one container. The configuration is that of a real cluster; only the replication factor (1) and the number of nodes differ. This keeps the project runnable on a laptop with 8 GB for Docker.

### One image for Hadoop, Hive, Flume and Sqoop

One build, one set of library versions, no compatibility drift between tools that share Hadoop's jars, and a faster setup.

---

## 6. Every folder and file

| Path | What it does |
|------|--------------|
| `README.md` | User guide: requirements, commands, ports, troubleshooting |
| `Makefile` | One short command per step (`make help` lists them) |
| `docker-compose.yml` | All containers, volumes, ports and start order |
| `.env.example` | Settings you can copy to `.env`: replay rate and limit, ports |
| `.shellcheckrc` | Settings for the shell-script linter |
| `docker/bigdata/Dockerfile` | Recipe for the shared image (Java, Hadoop, Hive, Flume, Sqoop, compatibility fixes) |
| `docker/bigdata/fetch-apache.sh` | Downloads Apache releases from fast mirrors, verifies checksums, resumes and detects stalls |
| `docker/bigdata/entrypoint.sh` | Chooses the container's role from its first argument |
| `docker/bigdata/roles/hadoop.sh` | Formats HDFS once, starts NameNode, DataNode, YARN and job history |
| `docker/bigdata/roles/hive.sh` | Initialises the metastore schema in MySQL, starts the metastore and HiveServer2 |
| `docker/bigdata/roles/flume.sh` | Starts a Flume agent with its config and HTTP metrics |
| `docker/bigdata/roles/replayer.sh` | Finds the log files, sorts them in calendar order, runs `replay.py` |
| `docker/bigdata/roles/client.sh` | Keeps the toolbox container alive for commands |
| `config/hadoop/*.xml` | `core-site`, `hdfs-site` (replication 1), `yarn-site` (memory, disk thresholds), `mapred-site` |
| `config/hive/hive-site.xml` | Metastore in MySQL, MapReduce as execution engine |
| `config/flume/agent1-log-to-kafka.conf` | Agent 1: TAILDIR → file channel → Kafka |
| `config/flume/agent2-kafka-to-hdfs.conf` | Agent 2: Kafka → file channel → HDFS |
| `mysql/init/01_databases_users.sql` | Creates databases and the `hive` and `sqoop` users |
| `mysql/init/02_weblogs_schema.sql` | Creates `status_codes` (with data) and the empty result tables |
| `hive/01_create_tables.sql` | Hive database, raw table, view, reference and result tables |
| `hive/02_analysis.sql` | Partition repair and the analytical queries |
| `sqoop/import_status_codes.sh` | MySQL `status_codes` → HDFS |
| `sqoop/export_results.sh` | Hive results in HDFS → MySQL, with explicit columns |
| `scripts/get-data.sh` | Downloads the two NASA `.gz` files into `data/raw` |
| `scripts/replay.py` | Replays log lines at a controlled, resumable rate |
| `scripts/check-counts.sh` | Proves no loss: lines replayed vs. lines in HDFS |
| `scripts/run-hive.sh` | Runs a Hive SQL file through Beeline |
| `scripts/control_server.py` | Control API in the client container: runs pipeline steps for the dashboard, one at a time, and keeps their output |
| `scripts/lib/common.sh` | Shared shell helpers (logging, checks, MySQL connection URL) |
| `data/raw/` | The two downloaded log archives (not in git) |
| `dashboard/` | Next.js web dashboard (`app/` pages, `components/` UI pieces, `lib/` helpers) |
| `docs/PROJECT_EXPLAINED.md` | This document |
| `docs/GETTING_STARTED.md` | Step-by-step run guide with expected output and a demo script |
| `docs/report.pdf`, `docs/slides.pdf` | Project report and presentation, generated from the real results |
| `docs/build/` | Generator of the report and slides: screenshots (`capture.ts`) and PDF rendering (`render.ts`) |
| `docs/meta.json` | Names, course and date printed on the report and slides |

---

## 7. Problems we hit and how we fixed them

Real problems, in the order we met them.

**(a) Downloads crawling at about 100 KB/s.** The official `archive.apache.org` throttles downloads, and the Hadoop release alone is hundreds of megabytes. Building the image would have taken hours. Fix: `fetch-apache.sh` now tries the Apache CDN and a mirror first, verifies each file against the official checksum published by Apache (so a fast mirror cannot slip in a corrupted or tampered file), and resumes partial downloads instead of starting over.

**(b) YARN jobs stuck in ACCEPTED.** Hive queries never started. The YARN web page showed the NodeManager as UNHEALTHY: by default, YARN refuses to use a disk more than 90% full, and the laptop disk was above that. Fix in `yarn-site.xml`: the threshold was raised to 98.5%, with a safety floor of 2 GB that must always stay free.

**(c) August replayed before July.** The replayer took files in alphabetical order, and "Aug" sorts before "Jul". Fix: `replayer.sh` sorts the files by month name in calendar order.

**(d) Sqoop mixing up columns.** With Sqoop 1.4.7 and MySQL Connector/J 8, Sqoop listed table columns in alphabetical order instead of their real order. Two symptoms: on import, the `status_codes` labels came out NULL in Hive because the fields were shifted; on export, Sqoop tried to put `/images/NASA-logosmall.gif` into the numeric `hits` column and failed with a `NumberFormatException`. Fix: both scripts name the columns explicitly with `--columns`.

**(e) The NASA download froze silently at 15 MB.** The connection stayed open but no data arrived, and nothing reported an error. Fix: the downloads detect a stall (no progress for a while), cut the connection and resume from where they stopped.

---

## 8. The real results

From the full run of both months:

### Data quality

| Measure | Value |
|---------|-------|
| Lines replayed | 3,461,613 |
| Lines lost | 0 |
| Malformed lines | 33 (0.001%) |

One malformed line is just `alyssa.p`: a line truncated in the original 1995 file. These 33 lines are kept in HDFS and counted, not silently thrown away.

### Question 1: top pages

The most requested path is `/images/NASA-logosmall.gif` with **208,798 hits**. The first real HTML page, `/ksc.html` (the Kennedy Space Center home page), comes **7th** with **83,918**.

What it means: a "hit" is any file request, not a page view. Every page loads the same small logos and icons, so images dominate the top of the list. To measure real page popularity you would filter on `.html` paths.

### Question 2: traffic by hour

| | Hour | Hits | Average per day |
|--|------|------|-----------------|
| Busiest | 15:00 | 230,665 | about 3,977 |
| Quietest | 04:00 | 58,990 | |

What it means: traffic follows the American working day. It peaks in the afternoon (server local time, US Eastern) and falls at night. This tells an operator when to schedule maintenance (around 4 a.m.) and when capacity matters most.

### Question 3: status codes and errors

| Status | Meaning | Hits | Share |
|--------|---------|------|-------|
| 200 | OK | 3,100,521 | 89.57% |
| 304 | Not Modified | 266,773 | 7.71% |
| 302 | Found (redirect) | 73,070 | 2.11% |
| 404 | Not Found | 20,871 | 0.60% |
| 403 | Forbidden | 224 | 0.0065% |
| 500 | Internal Server Error | 65 | 0.0019% |
| 501 | Not Implemented | 41 | 0.0012% |
| 400 | Bad Request | 15 | 0.0004% |

What it means: almost everything worked. The 304s are good news: browsers already had a cached copy, so the server sent nothing. The 404s are mostly broken links or mistyped addresses, worth a cleanup list. Server errors (5xx) are extremely rare, so the server itself was healthy.

### Question 4: most active hosts

The top host is `piweba3y.prodigy.com` with **21,987 requests**. Prodigy was a 1990s internet provider whose **proxy** servers fetched pages on behalf of many subscribers. So this is not one very busy person; it is many users hidden behind one machine name. Proxies aggregate traffic, which is why provider machines dominate this list.

---

## 9. Glossary

| Term | Meaning |
|------|---------|
| acks=all | Kafka producer setting: a message counts as sent only once the broker has stored it |
| Agent (Flume) | One running Flume process: source, channel, sink |
| Batch | Processing a large amount of stored data in one go |
| Block | A piece of an HDFS file, 128 MB by default |
| Broker | A Kafka server |
| Channel | Flume's buffer between source and sink; ours are file channels on disk |
| Common Log Format | The standard layout of a web access log line |
| Consumer group | Readers sharing a Kafka topic; Kafka stores their progress |
| Container (Docker) | A running instance of an image |
| DataNode | HDFS server holding the actual blocks |
| Docker Compose | Tool that starts several containers from one YAML file |
| Event | Flume's unit of data: a body (the line) plus headers |
| External table | Hive table that points at files it does not own |
| HDFS | Hadoop Distributed File System |
| Hive | SQL engine over files in HDFS |
| Image (Docker) | A frozen template from which containers start |
| Interceptor | Flume plug-in that inspects or modifies events, for example to add a header |
| Lag | Messages in Kafka not yet read by a consumer group |
| MapReduce | Parallel processing in map, shuffle and reduce steps |
| Metastore | Hive's catalogue of tables, columns and locations, stored in MySQL |
| MSCK REPAIR TABLE | Hive command that registers partition folders created by others |
| NameNode | HDFS server holding the file catalogue (which blocks, where) |
| NodeManager | YARN worker on each machine that runs tasks |
| Offset | Position of a message in a Kafka partition |
| Partition (Hive) | Sub-folder of a table, here one per day (`dt=YYYY-MM-DD`) |
| Partition (Kafka) | Ordered slice of a topic; ours has 3 |
| Proxy | A server that makes requests on behalf of many users |
| RegexSerDe | Hive SerDe that splits text into columns with a regular expression |
| Replication | Keeping several copies of each HDFS block; ours is 1 |
| ResourceManager | YARN's central scheduler |
| SerDe | Serializer/Deserializer: converts between file text and table columns |
| Sink | Where a Flume agent delivers events |
| Source | Where a Flume agent receives events |
| Sqoop | Bulk transfer tool between relational databases and HDFS |
| TAILDIR | Flume source that follows growing files and remembers its position |
| Topic | A named Kafka stream |
| View | A saved query that behaves like a table |
| Volume | Docker storage that outlives containers |
| YARN | Hadoop's resource manager and job scheduler |
| ZooKeeper | Coordination service that Kafka uses for cluster metadata |

---

## 10. Likely exam questions

**Why put Kafka between two Flume agents?**
To decouple collection from storage. If HDFS is slow or agent 2 is down, lines wait safely in Kafka. Kafka also absorbs traffic spikes, and other consumers (a real-time alert system, for example) could read the same topic without touching the pipeline.

**Why not write from Flume straight to HDFS?**
It would work, but then any HDFS problem backs up directly into the collector, whose only buffer is its own channel. Kafka gives a large, durable, replayable buffer and lets several systems consume the same stream.

**What happens if agent 2 stops?**
Agent 1 keeps publishing; messages accumulate in Kafka and the lag of group `flume-hdfs-writer` grows. When agent 2 restarts, it continues from its last committed offset. Nothing is lost or duplicated in the normal case.

**Why is Hive so slow on such small data?**
Each query becomes one or more MapReduce jobs, and every job pays a fixed startup cost: container allocation, JVM start, disk writes, shuffle. On small data, that overhead dominates. Hive is built for throughput on huge data, not for fast answers.

**What is a SerDe?**
The component that tells Hive how to read a row from a file and how to write it. Our RegexSerDe uses a regular expression to split each log line into seven columns.

**Why external tables?**
Flume owns the files. An external table only describes them, so dropping or recreating the table never deletes data.

**Why partition by day, and by event date?**
A query on one day reads one folder instead of all of them. The event date keeps 1995 data in 1995 folders even though it was ingested today.

**How did you prove no line was lost?**
`make counts` compares the number of lines replayed with the number stored in HDFS: 3,461,613 on both sides. Hive's `data_quality` table confirms the total and shows 33 malformed lines, still present.

**What happens to a malformed line?**
It gets no event timestamp, so agent 2 gives it the current time and it lands in today's partition. Hive's regex does not match, it becomes a NULL row, and it is counted in `data_quality`.

**What are the three parts of a Flume agent?**
Source (receives), channel (buffers), sink (delivers). We use file channels so the buffer survives a crash.

**Why does Sqoop run MapReduce?**
So that large transfers can be split across many mappers in parallel. Our tables are small, so we use one mapper.

**Why import `status_codes` from MySQL instead of hard-coding labels?**
It shows Sqoop in both directions, and keeps the reference data in one place: changing a label in MySQL changes it in the next report.

**What does ZooKeeper do here?**
It coordinates Kafka: it tracks the broker and stores cluster metadata.

**Why is the replication factor 1?**
There is only one DataNode; extra copies on the same disk would add nothing. A real cluster uses 3.

**What would you change for a real multi-node cluster?**
Several DataNodes with replication 3, a standby NameNode for high availability, several Kafka brokers with topic replication 3, more partitions to parallelise consumers, a faster engine than MapReduce for Hive (Tez or Spark), monitoring and alerting on Kafka lag, and security (authentication, encryption) instead of local default passwords.

**Why are images the top "pages"?**
Every HTML page loads the same logos, so each page view generates several image hits. Hits measure requests, not visits.

**Why is the top host a Prodigy machine?**
It is a provider's proxy: many subscribers' requests appear under one host name.
