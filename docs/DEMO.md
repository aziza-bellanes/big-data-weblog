# Record the full pipeline demo

Use the existing dashboard at http://localhost:3030.

The steps below are for a new recording from zero; they do not start a run automatically. If ingestion already shows **Succeeded**, keep that data: run **Run no-loss check**, then **Check every branch**, then **Run batch pipeline**. Reset is for repeating ingestion, not for advancing to analysis.

## Before recording

1. Open these tabs:
   - [Live pipeline](http://localhost:3030/pipeline)
   - [Real-time](http://localhost:3030/realtime)
   - [Data explorer](http://localhost:3030/explorer)
   - [Analytics](http://localhost:3030/analytics)
   - [YARN](http://localhost:8088/cluster)
2. Refresh the pipeline page to load the latest controls.
3. Check the cluster from the project directory:

   ```bash
   df -h .
   docker compose exec -T client python3 /opt/project/scripts/cluster_ready.py
   ```

   The second command should print `HDFS is writable and YARN has a healthy worker.` Also check that the speed layer is listening: `docker compose ps spark-streaming` should show `healthy` (it becomes healthy once its query has run its first trigger, and the Kafka producer waits for it). Spark needs about 1 to 2 GB of memory on top of the rest of the cluster. The web control estimates at least **7.5 GiB free** for a full replay. Leave extra room for the recording itself. The preparation on 18 November left about **10.4 GiB free**; check again if time has passed.
4. Record at 1080p and 30 fps with compressed video. Close large downloads and image builds for the duration of the demo. Allow roughly 30 minutes for the real run, based on the previous full measurement; pause recording or cut the waiting periods without stopping the pipeline.

## 1. Introduce the pipeline and clear the trial

Start recording on **Live pipeline**. Briefly show the data-flow diagram: three ingestion branches (including MySQL feeding the Sqoop import), with Kafka feeding both the HDFS writer and Spark, then Hive, the Sqoop export, MySQL and the dashboard.

Say:

> The pipeline has three ingestion branches that start together. Flume writes raw logs to HDFS, Kafka carries structured events, and Sqoop imports HTTP status reference data from MySQL. Kafka has two consumers: a writer that archives the events in HDFS, and Spark Structured Streaming, our speed layer, which computes per-minute traffic and alerts within seconds. Flume and Hive give the exact history afterwards, and we check that the two layers agree.

Scroll to the controls. Click **Start again from zero**, then **Empty it**. Wait for the reset job to show **Succeeded**. This clears the live logs, HDFS output, result tables and speed tables. The Kafka topic and Spark's checkpoint are kept, so Spark does not read earlier runs again.

## 2. Start the full ingestion

1. Choose **5K/s**.
2. Choose **Full dataset**.
3. Click **Start the three branches** once.
4. Record 30–60 seconds of the changing flow diagram, throughput chart and current-run log.

Point out that the replay and producer counters advance together, and the raw and JSON HDFS zones receive data independently. Open **Real-time** for a moment: Spark's per-minute figures and any alerts appear a few seconds behind the replay, while the batch part has not started yet. Sqoop has only 21 reference rows and usually finishes much earlier than the two log branches. It does not need to remain active for the entire replay.

Flume, Kafka and Spark ingestion do not create MapReduce applications. Sqoop and the later Hive queries do; use YARN to show those jobs.

## 3. Show the three HDFS zones

While ingestion runs, open **Data explorer**.

| Tab | What to show | HDFS location |
|---|---|---|
| Raw | Open a day folder and a completed file to show original log lines. | `/data/nasa/raw/flume` |
| Events | Open a day folder and a file to show JSON fields such as `event_id`, `host` and `http_status`. | `/data/nasa/streaming/kafka` |
| Speed | Open a `batch_id=N` folder to show Spark's Parquet output. | `/data/nasa/streaming/spark` |
| Reference | Open a `part-...` file to show status-code labels imported from MySQL. | `/data/nasa/reference/sqoop/status_codes` |

Use completed files for previews. Reopen a tab or refresh the explorer to see files created since its last listing. Show [YARN](http://localhost:8088/cluster) briefly for the Sqoop import, then return to the pipeline page.

## 4. Prove complete ingestion

At 5,000 lines per second, the source replay takes about 11 minutes 32 seconds. Allow additional time for the writer to catch up and files to close. Pause or cut this wait in the recording.

Wait until the ingestion job shows **Succeeded**. Then:

1. Click **Run no-loss check** and wait for success.
2. Click **Check every branch** and wait for success.
3. Show the console result, using its expand button if helpful.

Expected evidence:

| Check | Full-run result |
|---|---:|
| Replayed raw lines and closed HDFS raw lines | 3,461,613 each |
| Acknowledged Kafka events and unique HDFS event IDs | 3,461,613 each |
| Spark's position against the end of the topic | Lag 0 |
| Missing IDs, duplicate IDs and consumer lag | 0 each |
| Reference rows in MySQL and HDFS | 21 each |
| Exact raw content and reference content checks | Pass |

Some Kafka, writer, Spark and Flume widgets count events since the topic or process began, including earlier runs. Reset does not delete Kafka history. Use the **current-run measurements and branch-check output** for this recording's exact counts.

## 5. Run Hive and export to MySQL

Click **Run batch pipeline** once. Its four steps are:

1. Create Hive tables.
2. Check every branch against its source.
3. Run Hive analysis.
4. Export the six result tables to MySQL with Sqoop.

Record a short section of **Current run**, the console and **MapReduce jobs**. Switch to YARN to show a running Hive or export application. The job list also contains earlier jobs from the current cluster session.

Say:

> The ingestion branches have finished and passed their checks. Hive now performs the batch analysis and then checks that its daily totals equal those computed by Spark from Kafka. Sqoop exports the results into the reporting database.

At the end of the Hive analysis step, the speed check compares, for every day, Spark's totals with Hive's: the step fails unless they are equal. Mention it in the narration.

Pause or cut the longer queries. Wait until **all four steps and the batch job show Succeeded** before showing final analytics.

## 6. Present the results

Open **Analytics**, refresh it and confirm the source is `weblogs_parallel`. Scroll through the six questions (01 to 04 from the batch layer, 05 Suspicious activity, 06 Do both layers agree? with 58 of 58 days matching) and data quality. Then open **Real-time** again to show the speed-versus-batch table and the alerts.

| Result | Expected value |
|---|---|
| Most requested resource | `/images/NASA-logosmall.gif`, 208,798 requests |
| Busiest hour | 15:00, server time |
| HTTP 404 | 20,871 requests |
| HTTP 500 | 65 requests |
| Most active host | `piweba3y.prodigy.com`, 21,987 requests |
| Total lines | 3,461,613 |
| Parsed lines | 3,461,580 |
| Malformed lines, retained and counted | 33 |

Open **Data explorer → Results** to show the six output folders. Finish on the [Overview](http://localhost:3030) or the successful pipeline job. `make speed-layer` shows the same latest minutes and alerts in the terminal.

Closing line:

> The full dataset has been ingested through the parallel branches, checked against its sources, analysed by Hive and exported into six MySQL result tables. Spark's live figures from Kafka agree with Hive's exact results from Flume. All checks passed, and malformed records were counted rather than discarded silently.

## A concise final video

Keep the explanation, the real start, simultaneous ingestion, the Real-time page filling up, sample HDFS files, successful checks, a running Hadoop job and final results. Cut or accelerate waiting periods, keeping the start and final success of each phase visible.
