# Project walkthrough and presentation preparation

This guide describes the implementation in this repository. Read it in order once, then rehearse the questions near the end. The recording sequence is in [DEMO.md](DEMO.md).

## 1. Explain the purpose in one minute

> We built a reproducible web-log analytics pipeline using the Hadoop ecosystem. We replay historical NASA access logs as incoming traffic and ingest them through three independent branches started together: Flume writes the raw lines to HDFS, Kafka carries structured events, and Sqoop imports reference data. Kafka is linked to HDFS by a writer and is also read by Spark Structured Streaming, a speed layer that computes per-minute traffic and alerts within seconds. Hive on MapReduce and YARN analyses the raw lines in batch and Sqoop exports six result tables to MySQL. The pipeline checks that the speed layer and the batch layer report the same traffic. Our dashboard controls runs and displays actual results, live figures and system metrics.

The four business questions are the most requested resources, traffic by time, HTTP errors, and the most active client hosts. Data quality is measured separately.

> The web controls represent separate phases. **Start the three branches** collects the data, and the Real-time page already shows Spark's figures while it runs. After ingestion succeeds, run the checks and **Run batch pipeline** to analyse and export it. Empty MySQL result tables before that batch step are expected. Reset is only for intentionally repeating a run from zero.

The dataset fits on a laptop. The project demonstrates a big-data architecture and its operational behaviour; it does not claim that this input alone requires an industrial cluster.

## 2. Understand the input

The source is the NASA Kennedy Space Center web-server access-log dataset for July and August 1995. The downloaded files are under `data/raw/`, mounted read-only as `/data/input` in the client/replayer containers.

| File | Measured lines in our files |
|---|---:|
| `NASA_access_log_Jul95.gz` | 1,891,715 |
| `NASA_access_log_Aug95.gz` | 1,569,898 |
| Total | 3,461,613 |

The archives occupy about 36 MiB compressed. Reading them yields hundreds of megabytes of raw text. We process July before August, even though alphabetical sorting would put August first.

An actual first line is:

```text
199.72.81.55 - - [01/Jul/1995:00:00:01 -0400] "GET /history/apollo/ HTTP/1.0" 200 6245
```

| Part | Meaning |
|---|---|
| `199.72.81.55` | Client host/IP |
| `- -` | Missing ident/authenticated-user fields |
| Timestamp | Time of the request, including the server's UTC offset |
| `GET` | HTTP method |
| `/history/apollo/` | Requested resource |
| `HTTP/1.0` | Protocol |
| `200` | Successful HTTP response |
| `6245` | Response size in bytes |

A resource request can be for an image, not just an HTML page. A host can represent a proxy serving multiple people, so host counts are not counts of individual human visitors. A valid request returning 404 is an HTTP error, not a malformed log line.

Our measured full input contains 33 lines that do not match the raw-log parsing expression. They remain stored and are counted. The business queries use 3,461,580 parsed rows.

The [original archive page](https://ita.ee.lbl.gov/html/contrib/NASA-HTTP.html) prints a slightly different summary total, 3,461,612 requests. Our verification target is the actual downloaded files, counted above; do not invent a reason for the discrepancy. The published page also describes a server interruption during Hurricane Erin. Missing traffic dates must not be interpreted automatically as zero-demand days.

## 3. Learn the tools by responsibility

| Tool | Responsibility in this implementation |
|---|---|
| Docker | Runs isolated service processes from images. |
| Docker Compose | Defines services, internal DNS/network, volumes, dependencies, ports and health checks. |
| Make | Short commands for the underlying scripts and Docker operations. |
| Bash | Starts roles and orchestrates downloads, Hive and Sqoop commands. |
| Python | Replay, event parsing, Kafka producer/writer, the Spark job (PySpark), control API, verification, measurements and experiments. |
| Java 8 | Runtime for the Hadoop ecosystem components. |
| Flume 1.9.0 | Collects appended log lines and moves them through a durable channel into HDFS. |
| Kafka | Persistent partitioned event log; buffers between the producer and its two independent consumers, the HDFS writer and Spark. The image is `confluentinc/cp-kafka:7.6.1`. |
| Spark 3.5.9 | Structured Streaming speed layer: reads the Kafka topic in 5-second micro-batches and computes per-minute figures and alerts. Runs in local mode in its own container. |
| ZooKeeper | Broker coordination/metadata for this Kafka deployment, which is configured in ZooKeeper mode. |
| Hadoop 3.3.6 / HDFS | File storage: NameNode metadata and DataNode blocks. |
| YARN | Allocates resources and schedules application work on the Hadoop worker. |
| MapReduce | Execution framework used by the Hive queries and Sqoop transfers. |
| Hive 3.1.3 | SQL tables/views over HDFS; parses, joins and aggregates the logs. |
| Hive metastore | Table schemas, locations and partitions; its relational backend is MySQL. |
| HiveServer2 / Beeline | SQL server and JDBC command-line client used to submit Hive statements. |
| Sqoop 1.4.7 | Imports relational reference data to HDFS and exports Hive result files to MySQL. |
| MySQL 8.0 | Reference tables, final reporting tables, the speed-layer serving tables and a separate Hive-metastore database. |
| MySQL Connector/J | JDBC driver used by Java tools to talk to MySQL. |
| `confluent-kafka` | Python producer/consumer and offset inspection. |
| PyMySQL | Python SQL verification, and the Spark job's MySQL writes. |
| SQLite | Temporary on-disk set of event IDs during verification; not an application database. |
| Next.js 16 / React 19 / TypeScript | Dashboard server routes, rendered pages and interactive controls. |
| Tailwind CSS / shadcn / Base UI | Layout, styling and reusable accessible controls. |
| Recharts | Traffic, status and per-minute charts. |
| Motion / next-themes / Lucide / Sonner | UI motion, theme switching, icons and toast messages. |
| KafkaJS / `mysql2` | Dashboard-side Kafka metrics and MySQL access. |
| Playwright / Chromium | Real browser tests, screenshots and HTML-to-PDF printing. |
| Git / GitHub Actions | Version history and automated regression/validation checks on pushes. |
| unittest / ESLint / TypeScript / ShellCheck | Python behaviour, JavaScript rules/types and shell checks. |
| curl / gzip | Dataset downloads and compressed input handling. The `make data` downloader uses these host utilities. |

Processing, the web service, tests and document tools run in containers. Host Node is not required. The host still launches Docker/Compose, Make and the download script.

## 4. Separate the Hadoop components

HDFS is storage. Its NameNode manages file names, directories and mappings from files to blocks. The DataNode stores the blocks and serves their contents. File bytes do not live in the Hive metastore.

YARN is resource management. The ResourceManager schedules allocations. The NodeManager launches and monitors work on its node. Each application has an ApplicationMaster coordinating its tasks.

MapReduce is execution. For a page-count query, map work reads/parses records, shuffle groups matching page keys, and reduce work aggregates their counts. Hive constructs an execution plan, which can contain multiple jobs, so one SQL statement need not equal one YARN application.

Our `hadoop` Docker container runs NameNode, DataNode, ResourceManager, NodeManager and the MapReduce history server as separate processes. There is one physical machine and one DataNode: a pseudo-distributed teaching cluster, not several independent servers.

The configured HDFS replication factor is 1. Kafka also has one broker and replication factor 1. Restart persistence is provided by volumes, but this is not protection against losing the host disk. Kafka `acks=all` means all required in-sync replicas; with one replica, it does not create additional physical copies.

YARN advertises 4,096 MiB and four virtual cores; the maximum task allocation is 2,048 MiB. Map/reduce tasks are configured for 1,024 MiB, with an 800 MiB JVM heap. This YARN budget is separate from memory used by Kafka, Spark (its container is limited to 2 GB), MySQL, the dashboard and the Java service daemons.

A YARN container means a resource allocation and task process. In this setup it is not another Docker container.

Official background: [HDFS architecture](https://hadoop.apache.org/docs/r3.3.6/hadoop-project-dist/hadoop-hdfs/HdfsDesign.html) and [YARN architecture](https://hadoop.apache.org/docs/r3.3.6/hadoop-yarn/hadoop-yarn-site/YARN.html).

## 5. The pipeline: three branches, a speed layer and a batch part

```text
NASA archives
                           +-> live log -> Flume direct -> raw HDFS zone
  replay.py ---------------+
                           +-> Python producer -> Kafka web-events
                                                    -> Python writer -> JSON HDFS zone
                                                    -> Spark -> Parquet HDFS zone + MySQL weblogs_parallel (speed tables)

MySQL weblogs_parallel (status_codes) -> Sqoop import -> reference HDFS zone

raw zone + reference zone -> Hive -> result HDFS zone -> Sqoop -> MySQL weblogs_parallel -> dashboard
speed zone + raw zone ----> Hive speed check (the two layers must agree)
JSON zone ----------------> identity/recovery reconciliation; deduplication view
```

All three MySQL mentions are the same database, `weblogs_parallel`.

The branches are:

| Branch | Source | Destination |
|---|---|---|
| Flume | Replayed NASA log, read by Flume | `/data/nasa/raw/flume` |
| Kafka | The same NASA files, parsed by Python and sent through topic `web-events` | `/data/nasa/streaming/kafka` (JSON, by the writer) and `/data/nasa/streaming/spark` (Parquet, by Spark) |
| Sqoop | MySQL `status_codes` | `/data/nasa/reference/sqoop/status_codes` |

The professor's requirement is that Flume, Kafka and Sqoop start together from the beginning and that Kafka is linked to HDFS. The three branches satisfy it: they run concurrently, and Kafka reaches HDFS through the writer and through Spark. Flume and the Kafka producer each process the dataset independently. The source is not divided into thirds. Sqoop imports a different, small dataset: 21 status-code reference rows.

`scripts/parallel_ingestion.py` launches the replayer, Kafka producer and Sqoop import with `subprocess.Popen` before waiting for any result. Separate observer threads label and collect their logs. Waiting for the children afterward does not serialize their execution: they are already running. It reports every exit code and fails the overall ingestion if a branch fails. A branch finishing early, such as Sqoop, is expected.

The direct Flume agent, the Python HDFS writer and Spark are already-running Docker services. The launcher starts their data sources, not new Flume/HDFS/Spark daemons for every click. Spark starts at the end of the topic the first time, so the `kafka-producer` service waits until `spark-streaming` is healthy, which means its query has run its first trigger.

This concurrency was observed in the full-run record (`docs/evidence/parallel-full-run.json`): the two log branches lasted about 694 seconds while the reference import completed in about 24 seconds, overlapping them.

### Why this shape: a Lambda architecture

Before the speed layer, Kafka only made a second copy of the same lines that nobody used. Now each path has its own job:

| Layer | Path | Gives | Latency |
|---|---|---|---|
| Batch | Flume raw lines, Hive, Sqoop export | The exact history and the six result tables | After the run, minutes |
| Speed | Kafka, Spark | Per-minute traffic, per-host counts and alerts | A few seconds |
| Reference | Sqoop import | Status-code labels for the Hive join | Once |

This is a **Lambda architecture**: a batch layer that is complete and exact but late, and a speed layer that is early but must be reconciled with the batch layer. Here the reconciliation is automatic (section 8).

The parallel part is ingestion. Branch verification, Hive analysis, the speed check and the final export come afterward. The six reporting tables use the raw Flume branch, not the Kafka JSON views or Spark's tables. The JSON path demonstrates independent structured ingestion, recovery and identity reconciliation; the Spark path provides the live figures and the independent check.

The pipeline uses one Hive/MySQL database `weblogs_parallel` and one topic `web-events`; the folder names keep the historical word "parallel" because the branches run in parallel. `config/architectures.json` is the central registry used by Python, shell helpers and the dashboard.

## 6. Understand a Flume agent

```text
source -> channel -> sink
```

The source receives events. `TAILDIR` follows appended lines and persists file positions. A channel buffers events between input and output; our channels are backed by files so their buffered data can survive a process restart. The sink sends events to the next system. Interceptors add headers, such as the original event timestamp.

An agent is a configured service, not a custom Python component. We run one agent, a TAILDIR/file/HDFS agent (`config/flume/direct-to-hdfs.conf`). It does not go through Kafka: Flume and Kafka are two independent branches over the same source.

The file channel has capacity 1,000,000 events and transaction capacity 10,000. TAILDIR batches are 500 events and the HDFS sink uses batches of 1,000. These are buffer/batch settings, not guaranteed achieved throughput.

The HDFS sinks write text with `DataStream`. Files being written have a leading `_`, so Hive ignores unfinished output. A file is rolled/renamed when it is ready for readers. The direct agent uses a 30-second roll interval and a 10-second idle timeout, plus a 128 MiB roll-size threshold. This makes “last line written” and “last file closed” different events.

The agent initializes the timestamp header to zero before trying to extract a real date. Undated raw records therefore use `dt=1970-01-01`. Kafka events without a parsed date use `dt=unknown`. These fallback partitions do not describe real 1995 traffic dates.

Reference: [Flume 1.9 user guide](https://flume.apache.org/releases/content/1.9.0/FlumeUserGuide.html).

## 7. Understand Kafka and the custom Python branch

Kafka is a persistent log, not the SQL analytics engine. A producer appends records to a topic. A topic contains partitions, each with an ordered sequence of offsets. A consumer group records how far consumption has progressed. Our topic has two independent consumers: the HDFS writer (group `kafka-hdfs-writer`) and Spark, which keeps its own position in its checkpoint. Each moves at its own pace, and stopping one does not affect the other. The project topic `web-events` has three partitions, but there is still only one broker.

Ordering is per partition, not one global ordering across all three partitions. The queries aggregate records and do not require global arrival order.

Lag is the sum of end offsets minus committed positions. If a partition ends at 100 and its consumer has committed 80 as its next position, 20 records are pending. Lag is waiting work, not automatically lost work. Zero lag alone does not prove correct HDFS contents; source verification is also required.

### Parsing and identities: `scripts/events.py`

The event contract includes `event_id`, `source_file`, `source_line`, `raw_line`, `event_time`, `dt`, `host`, `method`, `resource`, `http_status`, `bytes` and `parse_error`.

```python
event_id = hashlib.sha256(f'{source}:{number}'.encode()).hexdigest()
```

The identity uses source file and line number. Replaying the same source record gives the same ID. Two identical HTTP requests on different source lines still have different IDs and must both count. Hashing only the raw text would incorrectly collapse legitimate repeated requests.

The parser retains raw text, parses dates with their offset, extracts request fields, maps a missing byte size `-` to zero, and preserves malformed records with a parse error rather than dropping them.

### Producer: `scripts/kafka_ingestion.py::produce`

It reads the source files, skips already-checkpointed records, uses the stable ID as Kafka key and serializes JSON. The producer enables idempotence and `acks=all`. Every 500 pending events it waits for acknowledgements before saving `producer.offset`.

The checkpoint must not advance just because a record was queued locally. The code also fingerprints the input dataset, topic and broker identity to prevent applying an old checkpoint to a different dataset accidentally.

### Writer: `publish` and `persist_and_commit`

It consumes batches of up to 50,000 messages, groups them by event day, writes a local JSON-lines file, uploads it to an HDFS name beginning `_inprogress-`, and renames it to a published `part-....jsonl` file. Only after publication does it commit Kafka offsets synchronously.

```python
publish(batch)
consumer.commit(offsets=next_positions, asynchronous=False)
```

The commit stores the next offset after each partition's last processed message. Committing before writing would risk losing records after a crash. Committing after writing can replay an already-published batch if a crash occurs between publication and commit. That is at-least-once delivery, with possible physical duplicates.

The Hive view `kafka_events_unique` keeps one row per stable ID with `row_number()`. Producer idempotence does not turn the complete Kafka-to-HDFS pipeline into exactly-once physical storage. The verified clean runs happened to have zero duplicate IDs.

The writer's `/metrics` count is restored from durable committed offsets after restart. It is cumulative, which avoids falsely resetting progress to zero during an in-flight run. Larger batches amortize the cost of launching the HDFS CLI's JVM.

Reference: [Kafka delivery semantics](https://kafka.apache.org/36/design/design/).

## 8. Understand the speed layer: Spark Structured Streaming

The speed layer is `scripts/spark_speed_layer.py`, run by `spark-submit` in the `spark-streaming` service (Spark 3.5.9, `--master local[2]`, driver memory 1 GB, container limit 2 GB). The Spark layer in the shared image is separate from the Hadoop layers, so adding it did not re-download Hadoop or Hive. The Kafka source of Spark is not in the distribution: its jars are fetched from Maven Central at build time.

### What it computes

Spark reads `web-events` as a stream, parses each JSON event, drops events whose `parse_error` is set, and computes the server-local minute from the first 16 characters of `event_time` (the producer keeps the log's own UTC offset, so this is the same clock as the Hive analysis). A trigger every **5 seconds** forms a micro-batch (at most 200,000 events). For each micro-batch it computes:

| Output | Content |
|---|---|
| `minute_stats` | Per day and minute: hits, 4xx, 404, 5xx and bytes |
| `host_minute` | Per day, minute and host: requests |

It writes them in two places:

| Destination | Role |
|---|---|
| HDFS Parquet, `/data/nasa/streaming/spark/minute_stats/batch_id=N` and `.../host_minute/batch_id=N` | The record. Hive reads it through external tables `speed_minute_parts` and `speed_host_minute_parts`, and the views `speed_traffic_minute` and `speed_alerts` (`hive/04_speed_layer.sql`). |
| MySQL `speed_minute`, `speed_host_minute`, `speed_alerts`, `speed_batches` | Serving tables for the dashboard's Real-time page (`mysql/schema/speed_layer.sql`). `make speed-layer` prints the latest minutes and alerts. |

### Alerts and thresholds

| Alert | Rule |
|---|---|
| `traffic_spike` | 300 hits or more in one minute |
| `not_found_burst` | 15 or more 404 in one minute |
| `server_errors` | 3 or more 5xx in one minute |
| `host_flood` | One host with 30 or more requests in one minute |

The thresholds sit above the 99.9th percentile of a normal NASA minute, measured on this dataset: 217 hits, 13 not-found and 16 requests from one host. So an alert marks a real anomaly rather than ordinary variation. The same numbers appear in the Spark job and in the Hive view `speed_alerts`.

### Exactly once

Each micro-batch has a number, `batch_id`. After a crash Spark replays the last micro-batch with the same number and the same Kafka offsets, so:

- the HDFS folder `batch_id=N` is overwritten with the same content;
- MySQL checks `speed_batches` first. If `batch_id` is already there, the batch is skipped. Otherwise the totals, the alerts of the minutes touched and the `speed_batches` row are written in **one transaction**.

The read position is the Spark **checkpoint** in HDFS (`/data/nasa/checkpoints/spark-speed-layer`), deliberately outside the output folder. `make reset` empties the outputs and MySQL speed tables but keeps the checkpoint, so Spark does not read earlier runs again. On its very first start, with no checkpoint, Spark begins at the end of the topic (`startingOffsets=latest`), which is why the producer waits for Spark's health check. Be careful with the claim: this is exactly-once for the speed layer's results (replayable source, idempotent sinks). The HDFS JSON archive remains at-least-once.

### The speed-versus-batch check

`hive/05_speed_check.sql` runs at the end of `make hive-analysis`. It joins, for every day, Spark's totals (hits, 4xx, 5xx from `speed_minute_parts`, derived from Kafka) with Hive's `hits_per_day` (derived from Flume's raw lines) in the table `speed_vs_batch`, and ends with an `assert_true` that fails the step, and therefore the pipeline, if any day differs or exists in one layer only. The two numbers come from two different copies of the data through two different engines, so their agreement is strong evidence that nothing was lost or doubled in either path. `make verify-ingestion` has a Spark section too: it reads the Spark checkpoint's last committed offsets and fails while Spark is still behind the end of the topic, so the check does not run on a half-processed stream.

### What it costs

One more container: Spark adds roughly 1 to 2 GB of memory (1 GB of driver memory plus JVM overhead, inside a 2 GB container limit), one more image layer and a consumer on the broker. On an 8 GB Docker budget it fits next to Hadoop, Hive and Kafka, but it takes a real share of that budget.

## 9. Understand HDFS partitions and Hive's schema

HDFS stores files, not relational rows. A location such as `/data/nasa/raw/flume/dt=1995-07-01/` groups records by event date. A Hive partition is a logical directory grouping; it is unrelated to a Kafka partition and is not an HDFS block.

`hive/01_create_tables.sql` defines the external raw table, the parsed view, the reference table and six result tables. External tables describe files already at specified HDFS locations. Hive's metastore tracks schemas, locations and partition metadata.

The raw table uses `RegexSerDe`. A SerDe converts between stored data and Hive's column representation. The expression extracts host, ident, authuser, timestamp, quoted request, status and bytes. A non-matching row yields null parsed fields. The `access_logs` view filters `host IS NOT NULL`, casts numeric fields and splits method/path/protocol.

`dt` comes from the directory name. `MSCK REPAIR TABLE ... SYNC PARTITIONS` registers new day directories and removes stale partition metadata after resets.

The hourly analysis uses the request's server-local clock hour. It is not the laptop's present timezone. Python retains the source offset, while Hive extracts the local timestamp/hour fields. Date partitioning is based on the historical request date, with the fallback handling described earlier.

`hive/03_kafka_events.sql` defines the JSON external table, a field-extraction view using `get_json_object`, and the event-ID deduplication view. `hive/04_speed_layer.sql` defines the Parquet tables written by Spark and the speed views. The six business aggregates do not read those views.

## 10. Explain the six analytical outputs

`hive/02_analysis.sql` rewrites each result with `INSERT OVERWRITE`. Rerunning analysis on unchanged inputs replaces its results instead of appending another set of aggregate rows.

| Table | Calculation | Full-run rows |
|---|---|---:|
| `top_pages` | Count requests by path; sort by count; take ten. | 10 |
| `hits_per_hour` | Count by hour and divide by observed distinct days for the average. | 24 |
| `hits_per_day` | Daily requests, 4xx errors, 5xx errors and distinct client hosts. | 58 |
| `status_distribution` | Count by status, join reference labels/categories and calculate percentages. | 8 |
| `top_hosts` | Count by host; sort; take ten. | 10 |
| `data_quality` | Total raw rows, parsed rows, malformed rows and malformed share. | 1 |

These sum to 111 reporting rows in MySQL, not 111 requests. The verified source has 58 observed valid dates; the hourly average divides by observed days, not every calendar date in July/August.

Representative query:

```sql
INSERT OVERWRITE TABLE top_pages
SELECT path, count(*) AS hits
FROM access_logs
WHERE path IS NOT NULL
GROUP BY path
ORDER BY hits DESC
LIMIT 10;
```

`GROUP BY` forms one group per resource, `count(*)` counts that group's requests, sorting ranks them, and `LIMIT` selects ten. MapReduce performs the underlying distributed-style execution; the dashboard does not calculate these counts itself.

The status reference join is a `LEFT JOIN`: a missing reference label should not remove an otherwise valid request. Status percentages use the parsed requests in `access_logs` as their denominator. Malformed percentage instead uses all rows in `access_logs_raw`.

Full-run figures to remember:

| Question | Result | Table |
|---|---|---|
| Total lines | 3,461,613 | `data_quality` |
| Parsed lines | 3,461,580 | `data_quality` |
| Malformed, retained | 33 | `data_quality` |
| Most requested resource | `/images/NASA-logosmall.gif`, 208,798 | `top_pages` |
| Busiest hour | 15:00 server time | `hits_per_hour` |
| HTTP 404 | 20,871 | `status_distribution` |
| HTTP 500 | 65 | `status_distribution` |
| Most active host | `piweba3y.prodigy.com`, 21,987 | `top_hosts` |

The NASA logo is an image resource. Do not describe it as the most visited HTML page. The full-dataset run, not a 200,000-line trial, is the evidence for these figures.

## 11. Understand Sqoop and the roles of MySQL

Sqoop import means relational database to Hadoop; export means Hadoop to relational database. The words describe direction relative to Hadoop.

The same MySQL service hosts two databases: `metastore` for Hive metadata and `weblogs_parallel` for the reference data, the results and the speed-layer tables. These are separate logical responsibilities, not two MySQL servers. The 21-row `status_codes` table is reference data initialized by `mysql/schema/weblogs.sql`; the speed tables come from `mysql/schema/speed_layer.sql` (applied by `make db-init`, safe to repeat); NASA's log files do not provide these human-readable labels.

For import, `sqoop/import_status_codes.sh` takes a lock, imports `code,label,category` into a staging directory with one mapper, verifies the complete staged contents against MySQL, moves the previous published directory aside, and promotes staging. It attempts restoration if promotion fails. This protects the published reference from ordinary import/validation failures. There are multiple filesystem operations, so do not describe the complete procedure as one cross-system transaction.

`-m 1` selects one mapper, appropriate for the small reference table. The output is tab-separated text, read by Hive's reference table.

For export, `sqoop/export_results.sh` visits each of the six HDFS result directories, truncates the corresponding MySQL table and exports it with explicitly named columns and one mapper. It passes tab delimiters and null markers. Explicit column order prevents Connector/J/Sqoop column-discovery order from putting values into the wrong fields.

Export is replacement per table, not a single transaction across all six tables. During a failed/incomplete export, MySQL could contain a mixture of empty, new or old tables. Wait for the whole batch job to succeed before presenting analytics. The data stays available in HDFS for a rerun of the export.

The dashboard reads these small materialized MySQL result tables for quick page loads, and the speed tables for the Real-time page. It does not run a new Hive scan of millions of lines whenever a chart opens. Spark writes the speed tables itself, not Sqoop: Sqoop only moves the six batch results.

## 12. Trace one web button through the code

```text
React button
 -> POST /api/jobs on the Next.js dashboard
 -> request validation
 -> HTTP request to client:8000/jobs
 -> Python control-server plan + readiness/resource checks
 -> background Runner -> project script processes
 -> Flume/Kafka/HDFS/Hive/Sqoop/MySQL
 -> job state and logs -> browser polling -> visible progress
```

The main UI file is `dashboard/components/pipeline/run-panel.tsx`. `pipeline-context.tsx` sends requests, handles errors/toasts and refreshes state. The Next.js route is `dashboard/app/api/jobs/route.ts`, and its internal HTTP client is `dashboard/lib/sources/control.ts`.

`scripts/control_server.py` defines allowed plans and launches work in background threads. A `Step` describes a command or measurement; a `Job` groups steps, status, parameters, logs and timing. A failed step marks later dependent steps skipped. Cancellation sends a signal to the process group.

The UI log's `$ make ...` text identifies the equivalent Make target. The Python server generally launches the underlying scripts directly; the browser does not receive arbitrary shell execution or a Docker socket. The client container already contains the required command-line tools and the mounted project.

Resource sets prevent conflicting work, such as two replays for the same branch or a reset during ingestion. Independent branch jobs can run concurrently.

The control API returns 202 when a job is accepted, 400 for an invalid request, 409 for resource conflicts and 503 when readiness/space prevents a start. Closing the browser does not stop a job. Restarting the client container can interrupt it; data checkpoints are resumable, but this is not a durable workflow engine that automatically resumes an arbitrary interrupted job graph.

Live logs and the short recent-job list are in server memory. Finished replay and pipeline records are saved under `/data/runs` in a named volume. Browser history is not the source of those records.

## 13. Explain what makes the dashboard live

`dashboard/hooks/use-pipeline.ts` polls `/api/pipeline` every two seconds. `dashboard/lib/pipeline.ts::takeSnapshot` probes the backing services concurrently and labels unavailable components down instead of inventing successful measurements.

| Information | Actual source |
|---|---|
| Replay/producer progress | Checkpoint files in the mounted live-log volume |
| Flume/channel/writer counters | Internal HTTP `/metrics` endpoints on port 34545 |
| Kafka message range and lag | KafkaJS admin API: topic and group offsets |
| Spark state, batches and speed-layer figures | The MySQL speed tables (`speed_batches`, `speed_minute`, `speed_alerts`) and the HDFS speed zone |
| HDFS folders, sizes and open files | NameNode WebHDFS HTTP API |
| Running/completed applications | YARN ResourceManager REST API |
| Charts and result rows | MySQL result tables via `mysql2` |
| Current job and terminal output | Python control API |

Rates are differences in counters divided by elapsed time, not labels copied from the requested replay rate. Polling is not WebSocket streaming. Charts are near-real-time views of ingestion; the Real-time page shows Spark's figures a few seconds behind the replay; SQL analytics are batch results that update after Hive/export, normally read again on page refresh.

Kafka topic totals and process/writer counters can include previous runs. Per-run measurements subtract the starting counters, and the source checker examines the current HDFS zones. A reset does not delete the Kafka topic, the Spark checkpoint or reset all service counters.

The web interface uses Next.js server routes so internal hostnames, credentials and service access remain on the server side. The control endpoints validate JSON actions and reject unexpected cross-origin browser requests. The deployment is local: host ports are bound to `127.0.0.1`.

## 14. Know each linked website and port

| Address | What it is | What to demonstrate |
|---|---|---|
| [localhost:3030](http://localhost:3030) | Custom dashboard Overview | Business answers and their source. |
| [localhost:3030/analytics](http://localhost:3030/analytics) | Six questions, two layers | Six tables' charts, errors, hosts, parsing quality, Spark's alerts and the day-by-day Hive versus Spark check. |
| [localhost:3030/realtime](http://localhost:3030/realtime) | Real-time page (speed layer) | Spark's per-minute traffic, alerts and the speed-versus-batch table, seconds behind the replay. |
| [localhost:3030/pipeline](http://localhost:3030/pipeline) | Live pipeline and controls | Data flow from the MySQL source to the dashboard, Kafka's two consumers, checks, batch run, logs, rates and current jobs. |
| [localhost:3030/explorer](http://localhost:3030/explorer) | Read-only custom HDFS browser | Raw logs, JSON events, reference rows and result files. |
| [localhost:9870](http://localhost:9870) | HDFS NameNode UI | Live DataNode, capacity, safe mode, storage/block health and directory listing. |
| [localhost:8088](http://localhost:8088) | YARN ResourceManager UI | Worker health, running/accepted/finished jobs and resource use. |
| [localhost:19888](http://localhost:19888) | MapReduce JobHistory UI | Completed MapReduce jobs, task details and counters. |
| [localhost:10002](http://localhost:10002) | HiveServer2 web UI | Hive service and session/query diagnostics; not the project's analytics dashboard. |

Port 3030 on the host forwards to port 3000 inside the dashboard container. MySQL is 3307 on the host but 3306 internally; it is a SQL protocol endpoint, not a website. Hive JDBC uses port 10000; the metastore uses internal port 9083. HDFS RPC uses internal port 9000. Kafka uses internal port 9092 and ZooKeeper 2181. Spark has no port of its own that we use: it only talks to Kafka, HDFS and MySQL. The Python control API is internal port 8000.

Names such as `mysql`, `hadoop`, `kafka` and `client` resolve on the Compose network. `localhost` inside a container means that container, not the host computer. This is why server-side service URLs differ from the browser links.

Use the custom explorer for file previews: its server can follow internal WebHDFS/DataNode addresses. An open HDFS or Hive webpage alone does not prove writes or jobs can succeed. Absence of a YARN job during pure Flume/Kafka ingestion is normal; those processes do not submit MapReduce applications.

## 15. Understand Docker and the important configuration

An image is a packaged filesystem/runtime. A container is a running instance. A volume keeps state outside an individual container's disposable filesystem. A bind mount exposes a specific host path inside a container.

`docker-compose.yml` declares the running services. One shared `weblogs/bigdata` image provides the ecosystem tools, and `docker/bigdata/entrypoint.sh` selects a role. Using the same image does not merge all services into one process. Kafka, ZooKeeper, MySQL and the dashboard have their own images. The Hadoop container intentionally holds several Hadoop daemons.

Persistent volumes hold HDFS state, Kafka records, MySQL files, live logs, Flume channels/positions and run records. The repository is mounted read-only in processing services. Writable logs, artifacts and state have dedicated mounts.

`kafka-init` and replay producers are one-off tasks: exiting with code zero is normal. Long-running daemons should remain running. The replay profile prevents traffic generation from starting just because the stack is brought up.

| File | Responsibility |
|---|---|
| `config/architectures.json` | Folders, topic, consumer group, Spark checkpoint and databases, in one registry. |
| `core-site.xml` | Default HDFS URI and Hadoop temporary location. |
| `hdfs-site.xml` | NameNode/DataNode storage, replication and network settings. |
| `yarn-site.xml` | Worker resources, shuffle service and disk-health thresholds. |
| `mapred-site.xml` | MapReduce-on-YARN, task memory and history-server settings. |
| `hive-site.xml` | MySQL metastore connection, HiveServer2 and MapReduce execution engine. |
| `config/flume/direct-to-hdfs.conf` | Source, channel, sink, timestamps, paths and roll settings. |
| `docker-compose.yml` (`spark-streaming`) | Spark command, 2 GB memory limit, health check on the ready file. |
| `.env` | Operator overrides such as replay settings and published ports. |

The bigdata Dockerfile pins Hadoop 3.3.6, Hive 3.1.3, Flume 1.9.0, Sqoop 1.4.7 and Spark 3.5.9 on Java 8; Spark is its own late layer, so rebuilding it does not refetch the others. It installs a compatible Guava copy across tools, Commons Lang 2 for Sqoop and MySQL Connector/J 8.0.33. These adjustments matter because mixing their original dependency jars can fail at runtime.

Apache packages are downloaded through a mirror list and checked against pinned checksums. A slow mirror affects image preparation, not steady-state Kafka throughput. `APACHE_MIRRORS` is a build argument. Image build cache and running data volumes are different things.

`make down` stops/removes the stack containers while retaining named data volumes. `make clean` also removes the volumes and their data. `make reset` clears the ingested data, results and speed tables, but keeps the Kafka topic and the Spark checkpoint. Starting again with retained checkpoints normally resumes rather than replaying already-written input.

## 16. Read the important code in this order

| File/function | What to explain aloud |
|---|---|
| `config/architectures.json` | One registry keeps every path, topic and database consistent. |
| `scripts/replay.py::replay` | Read source, resume at checkpoint, write controlled batches, flush/fsync, atomically save progress and pace output. |
| `scripts/events.py::event` | Parse one source line and assign a stable identity without collapsing repeated requests. |
| `scripts/parallel_ingestion.py::main` | Start all three subprocesses before waiting; collect each branch's outcome. |
| `scripts/kafka_ingestion.py::produce` | Acknowledgement-before-checkpoint and dataset identity. |
| `scripts/kafka_ingestion.py::persist_and_commit` | HDFS publication-before-offset-commit and the duplicate window. |
| `hive/01_create_tables.sql` | Raw regex schema, typed view, reference table and result locations. |
| `hive/02_analysis.sql` | Actual SQL answers and parsing-quality query. |
| `hive/03_kafka_events.sql` | JSON fields and deduplication view; not the business-query source. |
| `scripts/spark_speed_layer.py` | Micro-batch aggregation, per-batch Parquet folders, the MySQL transaction guarded by `speed_batches`, alert thresholds. |
| `hive/04_speed_layer.sql`, `hive/05_speed_check.sql` | Speed tables and views; the day-by-day agreement check that fails the pipeline. |
| `sqoop/import_status_codes.sh` | Import, validate staging, publish reference. |
| `sqoop/export_results.sh` | Replace six MySQL tables with explicit field order. |
| `scripts/control_server.py` | Whitelisted job plans, resources, states, subprocesses and logs. |
| `scripts/runs.py` | Measurement baselines, settling and lag. |
| `scripts/verify_ingestion.py` | Source-content, identity, Spark-progress and reference reconciliation. |
| `scripts/cluster_ready.py` | HDFS/YARN readiness and estimated replay-space budget. |
| `dashboard/lib/pipeline.ts` | Aggregate actual service probes into a live snapshot. |
| `dashboard/hooks/use-pipeline.ts` | Two-second polling and measured rate calculation. |
| `dashboard/lib/sources/mysql.ts` | Read the exported results for the selected database. |
| `docs/build/src/data.ts` and `render.ts` | Load live/evidence data and print the generated documents. |

The replay checkpoint is a count of source lines. The Flume TAILDIR position is a file-reading position. The Kafka committed offset is a next-record position per partition. They solve different recovery problems and are not interchangeable.

`save_state` writes a temporary checkpoint, flushes it, calls `fsync`, then uses `os.replace`. This avoids leaving a partly-written checkpoint file. Writing the output and replacing its checkpoint are still separate operations: do not claim an exactly-once transaction spanning the output log and checkpoint under arbitrary power loss.

## 17. Explain the verification and resilience evidence

Equal counts are useful but insufficient: losing one line and duplicating another can leave the count unchanged.

The raw verifier compares multisets of SHA-256 line hashes, including multiplicities. It checks closed raw HDFS files against the live source log. It rejects open Flume files and content/count mismatches.

The Spark verifier reads the last committed offsets in the Spark checkpoint and compares them with the Kafka end offsets; it fails while Spark is behind. Correctness of Spark's figures is checked separately by the speed-versus-batch assertion in Hive (section 8).

The Kafka verifier stores actual IDs in a temporary SQLite primary-key table, counts physical versus unique rows, checks every expected acknowledged source ID, and reads committed positions/lag. Its pass condition checks logical coverage and zero lag; physical duplicates are reported and can exist under the at-least-once design. It does not prove equality of every JSON payload field merely by checking IDs. Clean recorded runs had zero physical duplicates.

The reference verifier compares complete tab-separated row multisets between MySQL and HDFS, not just the number 21.

The full baseline checker (`make verify-analytics`) independently checks known expected values such as total lines, malformed count, top resource and error counts. The recent 200,000-line rerun also had an independent Python source aggregation matching all six MySQL outputs.

The recovery experiment pauses the Kafka HDFS writer while the producer publishes 60,000 additional records. It verifies that production advances, lag grows, the job finishes, lag drains after the writer resumes, and source checks pass. It needs unread input; after a full replay there are no remaining source records for that experiment. Spark has its own consumer position, so pausing the writer does not stop it, and restarting Spark replays at most its last micro-batch, which the `batch_id` rule absorbs.

The checks are different layers: the Python regression suite tests contracts and failure cases, including the speed layer's aggregation and exactly-once rules; TypeScript/ESLint/ShellCheck validate code; 20 browser combinations cover five pages, two themes and two widths; readiness fixtures exercise warning/disabled/error UI states; real stack runs test Hadoop integration. GitHub Actions runs the regression and configuration/shell checks, not the full Hadoop dataset on every push.

## 18. Understand the disk incident and reset fix

The host disk reached zero free space. The NameNode entered safe mode, which permits reads but refuses writes such as reset/deletion. YARN also marked its worker unhealthy because disk use exceeded the configured 98.5% threshold. Both that threshold and the 2,048 MiB minimum-free threshold apply.

The old Docker health probe only checked a startup marker file, which remained present after the failure. An open dashboard and a stale healthy marker did not prove writable HDFS or schedulable jobs.

The new shared check reads NameNode safe mode, live DataNodes, missing blocks and YARN's running workers. The control API checks it before mutations; the UI shows a reason and blocks ingestion/analysis when unavailable. Replay additionally estimates needed storage for live logs, Kafka and HDFS, retaining a 4 GiB buffer. The full-replay estimate is about 7.5 GiB; other applications or a recording still need their own space.

Reset checks HDFS first, clears HDFS and MySQL, and removes live logs/checkpoints last. A failed preflight or early HDFS operation therefore preserves checkpoints. This is failure protection, not a transaction covering every system.

Recovery required freeing disk, confirming a live DataNode and no missing blocks, then leaving safe mode. Merely forcing safe mode off without addressing resource exhaustion is not a repair.

The repaired 200,000-line run completed all branches, Hive and exports, and matched independent source calculations for all six tables. Thirty YARN applications succeeded, none failed. Evidence is in `docs/evidence/b-retry-20261118.json`. The demo preparation subsequently left about 10.4 GiB free without starting the full recording run.

## 19. Explain report and screenshot generation

The report, slides and guide are generated from TypeScript HTML templates and CSS, not hand-edited PDF pages. Cover metadata comes from `docs/meta.json`. Their files are `docs/build/src/report.ts`, `slides.ts`, `guide.ts`, shared layout/charts/diagram helpers, and the CSS under `docs/`.

`data.ts` loads the six live result tables from `weblogs_parallel`, the HDFS summary of the raw zone and the successful recovery evidence. The diagram of the pipeline, including the Spark branch, is drawn from data in `diagram.ts` and reused by the report, slides, guide and README. The PDFs are not a live re-verification: the recorded evidence files are fixed records of earlier runs, and the speed-layer pages describe the design and the check rather than quote new measurements.

`render.ts` builds HTML, waits for local fonts, checks content overflow, then asks Playwright's Chromium to print each document to PDF. SVG diagrams are also rendered to PNG for the README. Local fonts include Poppins, Archivo and JetBrains Mono, with the existing navy/sage/cream design.

`capture.ts` visits real pages (including the Real-time page) and runs project commands to capture browser and terminal evidence. Its `dashboard-live-run` shot starts the Hive analysis to show an active job; screenshot generation is not entirely passive and should not be launched during the recording. It rewrites the Hive result files from its current input but does not itself export them into MySQL. Screenshots that have not been captured yet are skipped by the document builders and appear after `make screenshots`.

```bash
make screenshots
make docs
```

These use the dedicated Docker docs service with Node and Chromium. That tools service mounts the Docker socket for nested project commands; the web dashboard does not need that socket. The PDF build requires a few core screenshots, populated canonical results and successful recovery evidence. It does not invent absent measurements.

## 20. Commands and their meaning

| Command | Meaning |
|---|---|
| `make data` | Download and validate compressed source files. |
| `make build` | Build application/ecosystem images. |
| `make up` | Start services; traffic does not start automatically. |
| `make db-init` | Ensure the relational schema, reference rows and speed tables exist (safe to repeat). |
| `make replay` | Start the Flume and Kafka log sources and the reference import; Spark is already listening. |
| `make speed-layer` | Print Spark's latest minutes and alerts from MySQL. |
| `make counts` | Compare source/live-log and closed raw HDFS line counts. |
| `make verify-ingestion` | Deeper raw, identity, Spark-progress and reference reconciliation. |
| `make pipeline` | Create tables, reconcile the branches, run Hive with the speed check, export results. |
| `make hive-analysis` | Run the analytical queries, then the speed-versus-batch check. |
| `make pipeline-parallel` | Foreground branch launcher followed by batch steps. |
| `make verify-analytics` | Check the full-dataset MySQL baseline, not a partial trial. |
| `make runs` | Show persisted run records. |
| `make topic-peek` | Read a few JSON messages from the topic. |
| `make beeline` | Hive SQL shell. |
| `make mysql` | MySQL SQL shell. |
| `make test-regression` | Python regression suite in Docker. |
| `make lint` | Shell, regressions, dashboard and docs checks. |
| `make reset` | Confirm and clear the data, results and speed tables for a fresh replay (the Spark checkpoint stays). |
| `make down` | Stop the stack and retain named volumes. |
| `make clean` | Remove stack volumes and their data as well. |

`LIMIT=0` means the full source. Positive limits are cumulative source-line limits, not that many additional records. A completed checkpoint will not replay itself merely because Start is pressed again; use a fresh reset when intentionally repeating from zero.

The benchmark-small/medium/stress targets use cumulative 10,000/20,000/30,000 limits and requested rates of 100/1,000/5,000. Their `end_to_end_seconds` measures ingestion plus verification in that benchmark script; it is not the full Hive/MySQL reporting pipeline duration. The web control's separate batch timing measures the batch steps.

## 21. Likely questions and short answers

**Why Flume and Kafka together?** Flume supplies log collection and configured sinks, and its raw lines are the exact input of the batch analysis. Kafka supplies a persistent decoupling buffer for structured events and lets two consumers, the HDFS writer and Spark, read the same stream independently.

**Why do the three tools start in parallel?** They are independent ingestion branches with separate sources and outputs: raw lines by Flume, structured events by Kafka, reference data by Sqoop. Starting them together is the requirement, and each can be verified against its own source.

**Is the entire system parallel?** Its ingestion branches are concurrent. Verification, analysis, the speed check and export are ordered phases afterward.

**Does it divide three million lines among three tools?** No. Both log branches process the source; Sqoop imports 21 different reference rows.

**Why add Spark? What was Kafka for before?** Before, Kafka only made a second copy of the same lines that nobody used. Spark gives it a real job: per-minute traffic and alerts within seconds, while Flume and Hive keep the exact history. Together they form a Lambda architecture.

**What is a Lambda architecture?** A batch layer that computes exact results over all the data, late, and a speed layer that computes approximate or partial results immediately; the two are reconciled. Here the batch layer is Flume, HDFS and Hive, the speed layer is Kafka and Spark.

**Why Spark Structured Streaming and not Flink or a Python consumer?** It was the Hadoop-ecosystem engine closest to the course, has a native Kafka source, offers micro-batches with checkpoints, and runs in local mode in the shared image. A plain Python consumer would have to rebuild checkpointing and the exactly-once handling by hand. Flink would add another ecosystem for no benefit at this size.

**Why a 5-second micro-batch?** It is short enough for a live view (a few seconds behind the replay) and long enough to keep batches non-trivial and the MySQL writes cheap. It is a trade-off, not a requirement; Structured Streaming's micro-batch model does not give millisecond latency.

**How is it exactly once?** The source is replayable (Kafka offsets are in the Spark checkpoint) and the sinks are idempotent: every micro-batch writes its own `batch_id` folder (overwritten on replay), and MySQL skips a `batch_id` already in `speed_batches`, written in the same transaction as the totals. A replayed batch therefore changes nothing. This applies to the speed layer's results; the HDFS JSON archive of the writer remains at least once.

**What happens if Spark crashes or is restarted?** It resumes from its checkpoint in HDFS, replays at most the last micro-batch, and the `batch_id` rule absorbs the replay. `make reset` keeps the checkpoint so Spark does not re-read old runs. On a first start, with no checkpoint, Spark starts at the end of the topic, so the producer waits for Spark's health check.

**How do you know Spark's numbers are right?** At the end of `make hive-analysis`, `hive/05_speed_check.sql` compares, for every day, Spark's hits, 4xx and 5xx with Hive's `hits_per_day`, computed from Flume's raw lines. The step fails unless they match, and `make verify-ingestion` waits until Spark has reached the end of the topic. Two different copies of the data, two different engines, one answer.

**Where do the alert thresholds come from?** From the data: they sit above the 99.9th percentile of a normal NASA minute (217 hits, 13 not-found, 16 requests from one host). So 300 hits, 15 404s, 3 5xx and 30 requests from one host per minute mark real anomalies. They are constants in the Spark job and in the Hive view, not tuned per day.

**What does Spark cost?** One more container: roughly 1 to 2 GB of memory (driver memory 1 GB, container limit 2 GB), an extra image layer and a second consumer on the broker. It is one of the reasons the project asks for 8 GB for Docker.

**Do Kafka events produce the business charts?** No. The six charts use raw Flume data aggregated by Hive and exported to MySQL. Kafka's events feed the HDFS JSON archive and Spark's live figures, and Spark's totals are used to cross-check the batch results.

**Why HDFS and MySQL?** HDFS holds raw/structured/reference/result files for batch processing. MySQL holds small relational reference/reporting tables and a separate metadata backend.

**What is the difference between Hive and MySQL?** Hive queries files through its SQL engine and MapReduce plan. MySQL stores and serves relational tables directly. The dashboard reads the exported MySQL tables.

**What runs a Hive query?** HiveServer2 accepts SQL, consults the metastore and compiles an execution plan. MapReduce tasks run under YARN and read/write HDFS. We configure `hive.execution.engine=mr`; Spark is used only for the streaming speed layer, not as Hive's engine.

**What if the writer stops?** Kafka retains accepted records while capacity/retention permit. Lag grows, then the restarted writer consumes from committed positions. The recorded recovery tests check that scenario.

**Can duplicates occur?** Yes. Delivery is at least once. Stable IDs and the Hive unique-event view address Kafka logical duplication; exact raw checks detect raw duplication, which requires a fresh valid replay before reporting.

**Does idempotent Kafka production guarantee end-to-end exactly once?** No. HDFS publication and Kafka offset commit are separate operations. Exactly once is achieved only in the speed layer, by a different mechanism (batch numbers).

**Why not hash the raw line as the event ID?** Legitimate identical requests can occur more than once. Source position identifies an occurrence; raw-content hashes serve a different verification purpose.

**Why is the Kafka widget greater than this run's source count?** It can include retained records and cumulative offsets from earlier runs. Use per-run deltas and the source reconciliation output.

**Why wait after replay reaches 100%?** Data must reach the sinks, Kafka lag must drain and raw files must close before Hive reads the completed files.

**Why 33 malformed records but many more HTTP errors?** Malformed means the log format could not be parsed. A correctly formatted 404/500 response is valid analytical input.

**Are hosts individual users?** No. A host/IP may represent several people, proxies or automated clients.

**Why is the busiest hour not my local timezone?** It is based on the historical server-local request hour.

**Is this highly available?** No. It is one host, one DataNode, one broker and replication factor 1. Persistent volumes help restart recovery but do not survive loss of their disk.

**What caused the demo failure?** Disk exhaustion caused HDFS safe mode and an unhealthy YARN worker. The old startup-file health check was insufficient. The repaired checks now test readiness and space before starting.

**Are the reports fabricated or manually typed measurements?** Their templates load the result tables from MySQL, use the recorded recovery evidence and print through Chromium. They do not invent absent measurements.

**What would you improve next?** Add multiple machines/replicas, stronger deployment security, columnar storage, a real Spark cluster instead of local mode, and a more transactional publication strategy. Measure repeated runs at multiple offered loads before claiming a throughput advantage. These are possible extensions, not features already demonstrated.

## 22. A focused study order for tonight

1. Explain the input line and the four business questions without looking.
2. Draw the pipeline from memory: three branches, Kafka's two consumers, the batch part and both directions of Sqoop.
3. Explain HDFS, YARN, MapReduce, Hive and MySQL as different responsibilities.
4. Explain the speed layer: why Spark, the 5-second micro-batch, the alert thresholds, `batch_id` and the speed-versus-batch check.
5. Read the replay, branch-launcher, publish/commit and Spark `write_batch`/`serve` functions; explain their ordering.
6. Read the six SQL queries and match each recorded number to its table.
7. Walk the web button-to-script path and identify what each linked website proves.
8. Rehearse the short answers on duplicates, parallelism, exactly once, cumulative counters and the disk incident.
9. Follow [DEMO.md](DEMO.md) for the actual recording, keeping background builds/downloads idle.
