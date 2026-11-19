# The Web Traffic Pipeline, Explained From Zero

This document explains the whole project to someone who has never touched a big data tool. Read it top to bottom once; after that, use the glossary and the exam questions at the end as a reference.

---

## 1. What this project is

We took the real access logs of the NASA Kennedy Space Center web server for July and August 1995, about 3.46 million lines, and built a small but complete big data pipeline around them. A script replays the old logs as if the website were live. Three ingestion branches start together: Flume collects the raw lines into HDFS, Kafka carries one structured event per line (stored in HDFS and also read by Spark, which computes live figures within seconds), and Sqoop brings in a reference table from MySQL. Hive runs SQL over the raw lines, and Sqoop copies the results into MySQL, where a web dashboard shows them. Everything runs in Docker containers on one laptop and starts with one command.

The pipeline answers six questions. The first four come from the batch layer, the last two from the speed layer:

1. What are the 10 most visited pages?
2. How is traffic distributed over the hours of the day?
3. What share of requests end in errors (404, 500, ...)?
4. Who are the 10 most active client hosts?
5. Is anything suspicious happening? Spark raises alerts for traffic spikes, 404 bursts, server errors and a single host flooding the server.
6. Do the two layers agree? Hive and Spark are compared day by day (58 of 58 days match).

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
| Near-real-time (streaming) | Process data continuously, a few seconds after it appears | Flume and Kafka moving each line as it is written, and Spark computing traffic per minute |

Batch is like doing the laundry once a week; streaming is like washing each dish right after you use it. Our project does both: lines flow in continuously, Spark answers within seconds, and the exact analysis runs in batch on top. Keeping both on purpose is called a **Lambda architecture**: a **batch layer** (exact, but late) and a **speed layer** (early, but it must be checked against the exact one). The project checks it automatically (section 3.11).

---

## 3. The tools

The big picture first:

```
NASA .gz files
     │
     ▼
 replayer ──► access.log ──► Flume ─────────────────────────────► HDFS raw lines  /data/nasa/raw/flume/dt=YYYY-MM-DD
     │
     └──► Python producer ──► Kafka topic "web-events" ──┬──► HDFS writer ──► HDFS JSON events
                                 (3 partitions)          │
                                                         └──► Spark (every 5 s) ──► HDFS Parquet + MySQL weblogs_parallel (speed tables)
                                                                                         │
 MySQL weblogs_parallel (status_codes) ── Sqoop import ──► HDFS reference                                   ▼
                                                                          dashboard "Real-time" page
 HDFS raw lines + reference ──► Hive ──► result tables ──► Sqoop export ──► MySQL weblogs_parallel ──► dashboard
                                   └──► speed check: Spark's daily totals = Hive's, or the run fails
```

All three MySQL mentions are the same database, `weblogs_parallel`.

### 3.1 HDFS: the warehouse

**HDFS** (Hadoop Distributed File System) stores very large files across many machines as if they were one disk.

- A file is cut into **blocks** (128 MB each by default). Each block is a separate piece that can live on a different machine.
- The **DataNodes** are the shelves: they hold the actual blocks.
- The **NameNode** is the catalogue at the front desk: it knows which blocks make up which file and on which DataNode each block lives. It does not hold the data itself.
- **Replication** means each block is copied to several DataNodes (3 by default), so losing one machine loses nothing.

Our cluster has a single DataNode, so the replication factor is **1**. A second copy on the same disk would protect against nothing. On a real cluster you would keep 3.

Our raw logs live under `/data/nasa/raw/flume/`, one folder per day, for example `/data/nasa/raw/flume/dt=1995-07-01/`. You can browse HDFS at http://localhost:9870.

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
| Topic | A named stream of messages, like a TV channel | `web-events` |
| Partition | A topic is split into ordered pieces so several readers can work in parallel | 3 partitions |
| Offset | The position number of a message inside a partition, like a page number | Each log line gets one |
| Consumer group | A team of readers sharing the work; Kafka remembers how far the team got | `kafka-hdfs-writer` (the HDFS writer); Spark keeps its own position in its checkpoint |
| Lag | How many messages are waiting, not yet read by the group | Grows when the HDFS writer is stopped, shrinks when it catches up |
| Broker | A Kafka server | One broker |

Messages are not deleted when read. They stay on disk for a retention period, and each consumer group keeps its own bookmark (the committed offset). That is why a reader can stop, restart and continue exactly where it left off. It is also why **two** independent readers can use the same topic: the HDFS writer and Spark each have their own bookmark and never disturb each other. This is the reason Kafka is in the project: before Spark, it only made a second copy of the same lines that nobody used.

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

We run one agent:

| Agent | Source | Channel | Sink |
|-------|--------|---------|------|
| direct | **TAILDIR**: follows `/data/live/parallel/access.log` like `tail -f`, and remembers its position in a JSON file | file channel | **HDFS sink**: writes to `/data/nasa/raw/flume/dt=%Y-%m-%d` |

Two interceptors matter:

- A **regex_extractor** interceptor reads the date inside the line (`01/Jul/1995:00:00:01`) and stores it as the `timestamp` header, in milliseconds.
- A **static** interceptor first sets the `timestamp` to 0, so a line without any date still has one. Such a line lands in the folder `dt=1970-01-01` instead of being dropped.

Files being written in HDFS start with `_`, so Hive never reads a half-written file. A file is closed every 30 seconds, at 128 MB, or after 10 seconds of inactivity.

### 3.5 Spark: the live scoreboard

**Spark** is a general engine for processing data in parallel. **Spark Structured Streaming** applies it to a stream: it treats the stream as a table that never stops growing and, every few seconds, processes the new rows as a small batch (a **micro-batch**). We use it as the **speed layer**.

- **Input:** Kafka topic `web-events`, as a second consumer next to the HDFS writer.
- **Every 5 seconds:** it parses the JSON events and computes, per minute, the hits, the 4xx errors, the 404s, the 5xx errors and the bytes, and the requests per host per minute.
- **Output:** the figures go to HDFS as **Parquet** files (a compact column format), one folder per micro-batch (`batch_id=N`), and to MySQL tables (`speed_minute`, `speed_host_minute`, `speed_alerts`, `speed_batches`) that the dashboard's *Real-time* page reads. Hive can query the Parquet files too (`speed_traffic_minute`, `speed_alerts`).
- **Alerts:** `traffic_spike` at 300 hits in a minute, `not_found_burst` at 15 404s, `server_errors` at 3 5xx, and `host_flood` when one host sends 30 requests in a minute. The thresholds sit above the 99.9th percentile of a normal NASA minute (217 hits, 13 not-found, 16 requests from one host), so an alert means something unusual, not just a busy minute.
- **Checkpoint:** Spark writes its read position (the Kafka offsets of the last micro-batch) into a checkpoint folder in HDFS, `/data/nasa/checkpoints/spark-speed-layer`. After a crash it continues from there. `make reset` keeps this folder, so Spark never re-reads old runs. On its very first start, with no checkpoint, it begins at the end of the topic.
- **Exactly once:** after a crash Spark may replay the last micro-batch with the same number. Its HDFS folder is simply overwritten with the same content, and MySQL skips a `batch_id` that is already in `speed_batches` (that row is written in the same transaction as the totals). So a minute is never counted twice.
- **Cost:** Spark runs in local mode in its own container, limited to 2 GB, and adds roughly 1 to 2 GB of memory to the project.

### 3.6 Hive: SQL on top of files

**Hive** lets you write SQL against files in HDFS. It translates each query into MapReduce jobs.

- **Metastore**: Hive has to remember that "table `access_logs_raw` = these files, with these columns". That description (the metadata) is stored in a MySQL database. The data itself stays in HDFS.
- **External table**: Hive only points at a folder; it does not own the files. Dropping the table leaves the files untouched. This is right for us, because Flume owns and writes those files.
- **SerDe** (Serializer/Deserializer): the piece that turns a line of text into columns. We use **RegexSerDe**: a regular expression with seven groups (host, ident, authuser, time, request, status, bytes). A line that does not match becomes a row of NULLs instead of crashing the query.
- **Partitions**: the table is split by a column `dt`, matching the folders `dt=1995-07-01`, `dt=1995-07-02`, and so on. A query about one day reads only that folder. It is like a filing cabinet with one drawer per day.
- **MSCK REPAIR TABLE**: Flume creates new day folders on its own, and Hive does not notice them. This command scans the table's folder and registers any new partitions.
- **View**: `access_logs` is a saved query on top of `access_logs_raw`. It keeps only well-formed lines and turns text into typed columns (`hour_of_day`, `method`, `path`, `status` as a number, bytes with `-` read as 0).

The analysis writes six result tables: `top_pages`, `hits_per_hour`, `hits_per_day`, `status_distribution`, `top_hosts` and `data_quality`.

### 3.7 Sqoop: the delivery truck

**Sqoop** copies data between a relational database and HDFS, in both directions. Each transfer runs as a MapReduce job (we use one mapper, `-m 1`, because the tables are small).

- **Import** (MySQL → HDFS): the small `status_codes` table ("404 = Not Found, Client Error") goes to `/data/nasa/reference/sqoop/status_codes`, so Hive can join it with the logs. The import is checked in a staging folder before it replaces the published copy.
- **Export** (HDFS → MySQL): each result table is emptied in MySQL (`TRUNCATE`), then reloaded from its HDFS folder.

### 3.8 MySQL: the reporting desk

**MySQL** 8.0 plays several roles: it stores the reference table `status_codes`, the final results and the speed-layer tables (database `weblogs_parallel`), and Hive's metastore. MySQL is what a business analyst or a website would actually query: fast for small answers, unlike Hive.

### 3.9 Docker: the shipping containers

Installing Java, Hadoop, Hive, Kafka, ZooKeeper, Flume, Sqoop, Spark and MySQL by hand takes hours and breaks easily. Docker packages them.

| Concept | Meaning | Analogy |
|---------|---------|---------|
| Image | A frozen, ready-to-run template of a system | A recipe, or a cake mould |
| Container | A running instance of an image | One cake baked from the mould |
| Volume | Storage that survives when a container is deleted | A fridge where you keep leftovers |
| Docker Compose | One file (`docker-compose.yml`) describing every container, its ports, volumes and start order | The seating plan for a dinner party |

**Our trick: one image, many roles.** Hadoop, Hive, Flume, Sqoop and Spark all need the same Hadoop libraries. Instead of five images, we built one image, `weblogs/bigdata`, with Hadoop 3.3.6, Hive 3.1.3, Flume 1.9.0, Sqoop 1.4.7 and Spark 3.5.9 (Spark is its own last layer, so adding it did not re-download the others). The `entrypoint.sh` script reads the first argument (`hadoop`, `hive`, `flume`, `replayer` or `client`) and runs the matching script in `roles/`; any other command, such as `spark-submit` for the speed layer, is run as it is. Same toolbox, different job.

Our containers:

| Container | Role |
|-----------|------|
| `mysql` | Database (results, reference data, Hive metastore) |
| `zookeeper`, `kafka` | Message queue and its coordinator |
| `kafka-init` | Runs once to create topic `web-events` with 3 partitions |
| `hadoop` | HDFS (NameNode + DataNode) and YARN (ResourceManager + NodeManager) and job history |
| `hive` | Metastore service and HiveServer2 |
| `flume-direct` | The Flume agent: log file to HDFS |
| `kafka-producer`, `kafka-hdfs-writer` | The Kafka branch: JSON events into the topic, and out of it into HDFS |
| `spark-streaming` | The speed layer: Spark, second reader of the topic (2 GB limit) |
| `replayer` | Simulates live traffic (started only by `make replay`, with the producer) |
| `client` | Toolbox for running Hive scripts, Sqoop and checks |

### 3.10 The web dashboard

The `dashboard/` folder holds a Next.js web application, served at http://localhost:3030. It is the shop window of the project. It reads the final results from MySQL, and shows the live state of the pipeline: Kafka (topic and consumer lag), Spark (micro-batches processed, from the MySQL speed tables), HDFS (day partitions), YARN (jobs) and the Flume agent's metrics (the agent exposes counters over HTTP, port 34545 by default, such as events received and delivered). Its pages are Overview, Analytics ("Six questions, two layers": the four batch questions and data quality, then **Suspicious activity** and **Do both layers agree?**), **Real-time** (the speed layer: key figures, traffic per minute, alerts, and a table of the speed layer against the batch layer), Live pipeline and Data explorer.

It can also **run the pipeline**. The buttons on the *Live pipeline* page do not run anything inside the dashboard itself: they ask a small **control API** (`scripts/control_server.py`) to do it. That API runs in the `client` container, which already has Hadoop, Hive and Sqoop installed, and it runs exactly the scripts the `make` targets run. It locks resources, allowing independent branches to overlap while refusing conflicting work, keeps the output of each job so the page can show it line by line, and can stop a job. It listens only on the private Docker network; the dashboard is the only thing that talks to it, and the dashboard only accepts these requests from its own pages.

Think of it as a remote control: the dashboard is the remote, the client container is the machine, and the buttons press the same keys you would press in a terminal.

---

### 3.11 Three ingestion branches and the two layers

The three branches start together and each ends in HDFS. Think of three counters at the same post office:

1. **Original letters:** `flume-direct` tails `/data/live/parallel/access.log` and writes unchanged lines to `/data/nasa/raw/flume`. This is the input of the batch layer.
2. **Structured copies:** `scripts/events.py` converts each source line into JSON. `kafka_ingestion.py produce` publishes to `web-events` with idempotence and `acks=all`, saving its checkpoint only after acknowledgements. `consume` uploads closed HDFS files to `/data/nasa/streaming/kafka`, publishes them by rename, then commits offsets synchronously. Spark reads the same topic for the speed layer.
3. **Address book:** Sqoop imports MySQL `status_codes` independently. It writes to staging, verifies its contents and swaps it into `/data/nasa/reference/sqoop/status_codes`, keeping a failed import from replacing a valid copy.

Each event ID identifies its source file and original line number. Two identical request lines at different positions remain different events; replaying the same position yields the same ID. A crash after HDFS publication but before a Kafka commit can produce duplicates. This is **at-least-once delivery**; `hive/03_kafka_events.sql` exposes `kafka_events_unique` to deduplicate logical events by ID. Raw physical rows remain available for inspection.

The raw Flume branch is the source of the six analytical tables. `make verify-ingestion` checks raw content as a multiset, every acknowledged Kafka source ID and zero consumer lag, that Spark has processed the topic to its end, and the exact Sqoop reference rows. Matching counts alone would not detect missing and substituted records.

**Speed layer against batch layer.** At the end of `make hive-analysis`, `hive/05_speed_check.sql` compares, day by day, Spark's totals (hits, 4xx, 5xx, computed from Kafka) with Hive's `hits_per_day` (computed from Flume's raw lines). If one day differs or exists in only one layer, an assertion fails and so does the whole pipeline. The two numbers come from two different copies of the data through two different engines: when they agree, we have strong evidence that nothing was lost or doubled on either path.

File locks prevent concurrent replayers or producers from sharing a checkpoint. The control API locks resources and permits independent branches to overlap. `config/architectures.json` is the single source for paths, databases, the topic, the consumer group and the Spark checkpoint.

### 3.12 Inspecting the website

**Data explorer** browses the HDFS zones. Overview and Analytics read the MySQL database; Real-time reads its speed tables; Live pipeline draws the three branches and Kafka's two consumers.

| Source | Responsibility |
|---|---|
| `scripts/architectures.py`, `config/architectures.json` | Shared settings: folders, topic, databases |
| `scripts/parallel_ingestion.py` | Independent Flume, Kafka and Sqoop orchestration |
| `scripts/events.py`, `scripts/kafka_ingestion.py` | Stable structured events, producer and durable writer |
| `scripts/spark_speed_layer.py` | The Spark speed layer |
| `hive/04_speed_layer.sql`, `hive/05_speed_check.sql` | Speed tables and views; the speed-versus-batch check |
| `mysql/schema/speed_layer.sql` | MySQL serving tables of the speed layer |
| `scripts/verify_ingestion.py`, `scripts/verify_analytics.py` | Source reconciliation and named full-dataset baseline |
| `dashboard/app/realtime/`, `dashboard/app/explorer/` | Real-time page and HDFS browsing page |
| `docker-compose.docs.yml`, `docs/build/Dockerfile` | Containerised screenshot/PDF tools |

The verified full run ([record `a0c1eb6ebd18`](evidence/parallel-full-run.json)) measured 3,461,613 source lines and 3,461,613 lines in HDFS, 59 raw HDFS files, and all six result tables matching their baseline; the two log branches took about 694 seconds at 5,000 lines per second, and the batch part about 16 minutes.

### Known limits

This is a single DataNode and Kafka broker, with replication 1, and Spark in local mode; it demonstrates restart recovery, not machine-failure redundancy. Malformed lines remain in the raw data. The Flume agent files undated lines under `dt=1970-01-01`, and structured Kafka events use `dt=unknown`. The analytical regex identifies malformed rows independently of those storage folders. Physical delivery to HDFS is at least once. A Flume write timeout can duplicate an original raw batch as well; counts and content reconciliation must pass before analysis, and a failed raw check requires a fresh replay. Kafka retains messages from earlier runs, and tool counters can be cumulative. The speed layer's results are exactly once, but they are only as complete as what Spark has read: the speed check is meaningful once the topic has been processed to its end.

## 4. Follow one line

Let us follow our example line, `199.72.81.55 - - [01/Jul/1995:00:00:01 -0400] "GET /history/apollo/ HTTP/1.0" 200 6245`, from start to finish.

1. **In the archive.** It sits inside `data/raw/NASA_access_log_Jul95.gz`, a compressed file downloaded by `make data`.
2. **Replayed.** `scripts/replay.py` reads the `.gz` files in calendar order (July before August) and appends lines to `/data/live/parallel/access.log` at `REPLAY_RATE` lines per second (500 by default). After each batch it saves its position in a state file, so a restart continues at exactly the next line.
3. **Picked up by Flume.** The TAILDIR source notices the new line in `access.log` and turns it into an event.
4. **Timestamped.** The `regex_extractor` interceptor finds `01/Jul/1995:00:00:01` in the line and adds the header `timestamp = <that moment in milliseconds>`. The event goes into the file channel on disk.
5. **Written to HDFS.** The HDFS sink reads the timestamp header, fills `dt=%Y-%m-%d` with `1995-07-01`, and appends the line to a file in `/data/nasa/raw/flume/dt=1995-07-01/`. The file is named with a leading `_` while open, then renamed when closed.
6. **Turned into an event.** In parallel, the Python producer reads the same source line, builds a JSON event (stable `event_id`, host, resource, status 200, bytes 6245, event time with its UTC offset) and publishes it to topic `web-events`. With `acks = all`, it only considers the message sent once Kafka confirms it is stored. The event lands in one of the 3 partitions and gets an offset.
7. **Archived.** The HDFS writer reads batches of events, writes a JSON file in HDFS under `/data/nasa/streaming/kafka`, publishes it, and only then commits the offset.
8. **Counted live.** Spark reads the event in its next 5-second micro-batch and adds it to the totals of the minute `1995-07-01 00:00` (one hit, status 200, 6,245 bytes) and to the count of its host in that minute. It writes the batch to HDFS (`batch_id=N`) and to MySQL, where the Real-time page shows it.
9. **Seen by Hive.** `MSCK REPAIR TABLE` registers the partition `dt=1995-07-01`. RegexSerDe splits the line into seven columns; the view `access_logs` turns it into `host = 199.72.81.55`, `hour_of_day = 0`, `method = GET`, `path = /history/apollo/`, `status = 200`, `bytes = 6245`.
10. **Counted.** The queries in `hive/02_analysis.sql` count it once in `hits_per_hour` (hour 0), once for status 200 in `status_distribution` (labelled "OK" thanks to the imported `status_codes`), once for its host, and once for 1 July in `hits_per_day`. Results are written to `/data/nasa/results/...` in HDFS.
11. **Cross-checked.** `hive/05_speed_check.sql` compares the total for 1 July in `hits_per_day` with the total Spark computed from Kafka. They must be equal.
12. **Exported.** `sqoop/export_results.sh` empties each MySQL result table and reloads it from HDFS.
13. **Shown.** The dashboard queries MySQL and draws the charts. Our line is now one tiny part of the bar for midnight.

---

## 5. Design decisions and why

### Partition by event date, not ingestion date

If Flume used the current time, all 1995 data replayed today would land in one folder named after today, and "traffic on 1 July 1995" would be meaningless. By reading the real request time from the line into a header, each line goes to the folder of the day it actually happened. It is like filing a letter by the date written on it, not by the day it arrived in the mailroom. The Kafka branch does the same with the `dt` field of its events.

### No data loss

Every stage is designed to survive a stop:

| Risk | Protection |
|------|------------|
| Flume agent crashes with events in its buffer | The file channel keeps the buffer on disk |
| Kafka loses a message it said it had | Producer waits for `acks = all` |
| The HDFS writer is stopped | Messages wait in Kafka; on restart it resumes from its committed offset |
| Spark is stopped or crashes | It resumes from its checkpoint; a replayed micro-batch is absorbed by its `batch_id` |
| Flume restarts | TAILDIR position file remembers where it stopped in `access.log` |
| Replayer restarts | State file holds its offset, so no line is skipped or duplicated |

And we do not just trust it: `make counts` (`scripts/check-counts.sh`) compares the number of lines replayed with the number of lines in HDFS, `make verify-ingestion` checks every branch against its source, and the speed check compares two independent paths.

### Malformed lines are kept and counted

Most malformed lines still contain a valid date (for example a request with a broken quote), so Flume timestamps them and they land in the right day folder. A line without any date gets no real timestamp; instead of dropping it, Flume keeps the default timestamp 0, so it lands in the folder `dt=1970-01-01`. In the full dataset this happens to exactly one line, `alyssa.p`: the last line of the July file, cut off and without a final newline. In Hive the regex does not match any malformed line, the row is all NULLs, the view skips it, and the `data_quality` table counts it. Bad data is measured, not hidden.

### Decoupled containers

Each service runs in its own container. One can be stopped, restarted or upgraded without touching the others, and Kafka in the middle means the producer, the HDFS writer and Spark never have to run at the same speed.

### Two layers, one check

The batch layer (Flume, Hive) is exact but late; the speed layer (Kafka, Spark) is early. Rather than trusting either, the pipeline compares them for every day and stops if they differ. A bug on one path, such as a lost batch or a double count, would show up as a difference.

### Single node as a deliberate limit

HDFS and YARN run "pseudo-distributed": all daemons in one container. The configuration is that of a real cluster; only the replication factor (1) and the number of nodes differ. Spark runs in local mode for the same reason. This keeps the project runnable on a laptop with 8 GB for Docker.

### One image for Hadoop, Hive, Flume, Sqoop and Spark

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
| `docker/bigdata/Dockerfile` | Recipe for the shared image (Java, Hadoop, Hive, Flume, Sqoop, Spark, compatibility fixes) |
| `docker/bigdata/fetch-apache.sh` | Downloads Apache releases from fast mirrors, verifies checksums, resumes and detects stalls |
| `docker/bigdata/entrypoint.sh` | Chooses the container's role from its first argument |
| `docker/bigdata/roles/hadoop.sh` | Formats HDFS once, starts NameNode, DataNode, YARN and job history |
| `docker/bigdata/roles/hive.sh` | Initialises the metastore schema in MySQL, starts the metastore and HiveServer2 |
| `docker/bigdata/roles/flume.sh` | Starts a Flume agent with its config and HTTP metrics |
| `docker/bigdata/roles/replayer.sh` | Finds the log files, sorts them in calendar order, runs `replay.py` |
| `docker/bigdata/roles/client.sh` | Keeps the toolbox container alive for commands |
| `config/hadoop/*.xml` | `core-site`, `hdfs-site` (replication 1), `yarn-site` (memory, disk thresholds), `mapred-site` |
| `config/hive/hive-site.xml` | Metastore in MySQL, MapReduce as execution engine |
| `config/flume/direct-to-hdfs.conf` | The Flume agent: TAILDIR → file channel → HDFS |
| `config/architectures.json` | Folders, topic, consumer group, Spark checkpoint and databases |
| `mysql/init/01_databases_users.sql` | Creates databases and the `hive` and `sqoop` users |
| `mysql/schema/weblogs.sql` | Creates `status_codes` (with data) and the empty result tables |
| `mysql/schema/speed_layer.sql` | Creates the speed-layer serving tables (`speed_minute`, `speed_host_minute`, `speed_alerts`, `speed_batches`) |
| `hive/01_create_tables.sql` | Hive database, raw table, view, reference and result tables |
| `hive/02_analysis.sql` | Partition repair and the analytical queries |
| `hive/03_kafka_events.sql` | Tables and views over the JSON events, with deduplication |
| `hive/04_speed_layer.sql` | Parquet tables written by Spark, speed views and alert view |
| `hive/05_speed_check.sql` | Fails the pipeline unless Spark's daily totals equal Hive's |
| `sqoop/import_status_codes.sh` | MySQL `status_codes` → HDFS |
| `sqoop/export_results.sh` | Hive results in HDFS → MySQL, with explicit columns |
| `scripts/get-data.sh` | Downloads the two NASA `.gz` files into `data/raw` |
| `scripts/replay.py` | Replays log lines at a controlled, resumable rate |
| `scripts/events.py`, `scripts/kafka_ingestion.py` | JSON events with stable IDs; Kafka producer and HDFS writer |
| `scripts/spark_speed_layer.py` | The Spark Structured Streaming speed layer |
| `scripts/verify_ingestion.py` | Reconciles every branch with its source, Spark progress included |
| `scripts/check-counts.sh` | Proves no loss: lines replayed vs. lines in HDFS |
| `scripts/run-hive.sh` | Runs a Hive SQL file through Beeline |
| `scripts/control_server.py` | Control API in the client container: runs pipeline steps for the dashboard, one at a time, and keeps their output |
| `scripts/lib/common.sh` | Shared shell helpers (logging, checks, MySQL connection URL) |
| `data/raw/` | The two downloaded log archives (not in git) |
| `dashboard/` | Next.js web dashboard (`app/` pages, `components/` UI pieces, `lib/` helpers) |
| `docs/PROJECT_EXPLAINED.md` | This document |
| `docs/GETTING_STARTED.md` | Step-by-step run guide with expected output and a demo script |
| `docs/report.pdf`, `docs/slides.pdf` | Project report and presentation, generated from the real results |
| `docs/build/` | Generator of the report, slides and guides: screenshots (`capture.ts`) and PDF rendering (`render.ts`) |
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
| Batch layer | The exact, late path: Flume, HDFS, Hive |
| Block | A piece of an HDFS file, 128 MB by default |
| Checkpoint (Spark) | Folder where Spark saves its read position, so it can continue after a crash |
| Broker | A Kafka server |
| Channel | Flume's buffer between source and sink; ours are file channels on disk |
| Common Log Format | The standard layout of a web access log line |
| Consumer group | Readers sharing a Kafka topic; Kafka stores their progress |
| Container (Docker) | A running instance of an image |
| DataNode | HDFS server holding the actual blocks |
| Docker Compose | Tool that starts several containers from one YAML file |
| Event | Flume's unit of data: a body (the line) plus headers |
| Exactly once | Each input counted once in the result, even after a crash and replay |
| External table | Hive table that points at files it does not own |
| HDFS | Hadoop Distributed File System |
| Hive | SQL engine over files in HDFS |
| Image (Docker) | A frozen template from which containers start |
| Interceptor | Flume plug-in that inspects or modifies events, for example to add a header |
| Lag | Messages in Kafka not yet read by a consumer group |
| Lambda architecture | A batch layer for exact results plus a speed layer for fast ones, reconciled |
| MapReduce | Parallel processing in map, shuffle and reduce steps |
| Micro-batch | A small group of new messages that Spark processes together, every 5 seconds here |
| Metastore | Hive's catalogue of tables, columns and locations, stored in MySQL |
| MSCK REPAIR TABLE | Hive command that registers partition folders created by others |
| NameNode | HDFS server holding the file catalogue (which blocks, where) |
| NodeManager | YARN worker on each machine that runs tasks |
| Offset | Position of a message in a Kafka partition |
| Partition (Hive) | Sub-folder of a table, here one per day (`dt=YYYY-MM-DD`) |
| Parquet | Compact column-oriented file format, used for Spark's output |
| Partition (Kafka) | Ordered slice of a topic; ours has 3 |
| Proxy | A server that makes requests on behalf of many users |
| RegexSerDe | Hive SerDe that splits text into columns with a regular expression |
| Replication | Keeping several copies of each HDFS block; ours is 1 |
| ResourceManager | YARN's central scheduler |
| SerDe | Serializer/Deserializer: converts between file text and table columns |
| Sink | Where a Flume agent delivers events |
| Source | Where a Flume agent receives events |
| Spark Structured Streaming | Spark's engine for continuous processing of a stream, in micro-batches |
| Speed layer | The fast path: Kafka, then Spark; figures within seconds |
| Sqoop | Bulk transfer tool between relational databases and HDFS |
| TAILDIR | Flume source that follows growing files and remembers its position |
| Topic | A named Kafka stream |
| View | A saved query that behaves like a table |
| Volume | Docker storage that outlives containers |
| YARN | Hadoop's resource manager and job scheduler |
| ZooKeeper | Coordination service that Kafka uses for cluster metadata |

---

## 10. Likely exam questions

**Why is Kafka in the project?**
It carries one structured event per log line to two independent readers: a writer that archives the events in HDFS, and Spark, the speed layer. It decouples the producer from its consumers, absorbs traffic spikes, and each reader keeps its own bookmark, so one can stop without disturbing the other. Before Spark, Kafka only made a second copy of the same lines that nobody used.

**Why not write from Flume straight to HDFS only?**
That is what the Flume branch does: it gives the exact raw history that Hive analyses. Kafka and Spark add something Flume to HDFS cannot: answers within seconds, while the run goes on.

**Why Spark? Why not only Hive?**
Hive is exact but runs after the data is stored, and each query costs minutes. Spark Structured Streaming reads the Kafka topic continuously and computes traffic per minute and alerts every 5 seconds. We keep both and check that they agree.

**What is a Lambda architecture?**
Two paths over the same data: a batch layer (here Flume, HDFS and Hive) that is exact but late, and a speed layer (Kafka and Spark) that is early. They are reconciled, here by an assertion that fails the pipeline when the daily totals differ.

**How is the speed layer exactly once?**
Every micro-batch writes its own `batch_id` folder in HDFS, overwritten if replayed, and MySQL skips a `batch_id` already in `speed_batches`, written in the same transaction as the totals. The read position is Spark's checkpoint. So a replay after a crash changes nothing. (The HDFS JSON archive of the Kafka writer is still at least once.)

**How do you check that Spark's numbers are right?**
`hive/05_speed_check.sql`, run at the end of `make hive-analysis`, compares for every day Spark's totals (from Kafka) with Hive's `hits_per_day` (from Flume's raw lines). Two different copies of the data, two different engines: the pipeline fails unless they agree.

**Where do the alert thresholds come from?**
From the data: 300 hits, 15 404s, 3 server errors and 30 requests from one host per minute are above the 99.9th percentile of a normal NASA minute (217 hits, 13 not-found, 16 requests from one host), so an alert marks a real anomaly.

**What does Spark cost?**
One more container and roughly 1 to 2 GB of memory, in local mode with a 2 GB limit.

**What happens if the HDFS writer stops?**
The producer keeps publishing; messages accumulate in Kafka and the lag of group `kafka-hdfs-writer` grows. When the writer restarts, it continues from its last committed offset. Spark has its own position and is not affected.

**Why is Hive so slow on such small data?**
Each query becomes one or more MapReduce jobs, and every job pays a fixed startup cost: container allocation, JVM start, disk writes, shuffle. On small data, that overhead dominates. Hive is built for throughput on huge data, not for fast answers.

**What is a SerDe?**
The component that tells Hive how to read a row from a file and how to write it. Our RegexSerDe uses a regular expression to split each log line into seven columns.

**Why external tables?**
Flume owns the files. An external table only describes them, so dropping or recreating the table never deletes data.

**Why partition by day, and by event date?**
A query on one day reads one folder instead of all of them. The event date keeps 1995 data in 1995 folders even though it was ingested today.

**How did you prove no line was lost?**
`make counts` compares the number of lines replayed with the number stored in HDFS: 3,461,613 on both sides. `make verify-ingestion` checks each branch against its source, and Hive's `data_quality` table confirms the total and shows 33 malformed lines, still present.

**What happens to a malformed line?**
It gets no event timestamp, so Flume keeps the default timestamp 0 and it lands in `dt=1970-01-01`. Hive's regex does not match, it becomes a NULL row, and it is counted in `data_quality`.

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
Several DataNodes with replication 3, a standby NameNode for high availability, several Kafka brokers with topic replication 3, more partitions to parallelise consumers, Spark on a cluster instead of local mode, a faster engine than MapReduce for Hive (Tez or Spark), monitoring and alerting on Kafka lag, and security (authentication, encryption) instead of local default passwords.

**Why are images the top "pages"?**
Every HTML page loads the same logos, so each page view generates several image hits. Hits measure requests, not visits.

**Why is the top host a Prodigy machine?**
It is a provider's proxy: many subscribers' requests appear under one host name.
