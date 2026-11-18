# Getting started

This guide takes you from an empty machine to a running pipeline and a live demo. You do not need to know Docker. Run every command in a terminal, from the project folder, unless the guide says otherwise.

## 1. What you will have at the end

By the end you will have a small big data cluster running on your laptop inside Docker containers. It replays two months of real NASA web server logs (July and August 1995) like live traffic. Two Flume agents carry them through Kafka into HDFS. Hive analyses them, Sqoop moves the results into MySQL, and a web dashboard shows everything.

Web pages you can open in your browser:

| Page | Address |
|------|---------|
| Project dashboard | http://localhost:3030 |
| HDFS (NameNode) | http://localhost:9870 |
| YARN (ResourceManager) | http://localhost:8088 |
| MapReduce job history | http://localhost:19888 |
| HiveServer2 | http://localhost:10002 |

## 2. Requirements

| Resource | Needed | Notes |
|----------|--------|-------|
| RAM | 8 GB free for Docker | A machine with 16 GB is recommended |
| Disk | About 8 GB free | YARN refuses to run jobs when less than 2 GB stays free |
| CPU | 4 cores recommended | 2 cores work, just slower |
| Internet | Only for the first build | About 1.1 GB for the project image, about 1.2 GB for the MySQL, Kafka and ZooKeeper images, about 36 MB for the dataset |

## 3. Install the prerequisites

You need four tools: Docker (runs the containers), Docker Compose (starts many containers together), `make` (short commands for long ones) and `curl`/`gzip` (download and check the dataset). Follow the section for your system.

### Linux (Ubuntu or Debian)

1. Install Docker Engine and the Compose plugin by following the official guide: https://docs.docker.com/engine/install/ (pick your distribution). On Ubuntu the package to install at the end is `docker-ce docker-ce-cli containerd.io docker-compose-plugin`.
2. Let your user run Docker without `sudo`:

   ```bash
   sudo usermod -aG docker $USER
   ```

   Then log out and log back in (or reboot). This step is required, otherwise every command fails with "permission denied".
3. Install the small tools:

   ```bash
   sudo apt update && sudo apt install -y make curl gzip git
   ```

   (On Fedora: `sudo dnf install make curl gzip git`. On Arch: `sudo pacman -S make curl gzip git`.)

### macOS

1. Install Docker Desktop: https://www.docker.com/products/docker-desktop/ (choose Apple Silicon or Intel). Start it once and wait until the whale icon says it is running.
2. In Docker Desktop, open Settings, then Resources, and give it at least 8 GB of memory.
3. Install the Xcode command line tools, which provide `make` and `git`:

   ```bash
   xcode-select --install
   ```

`curl` and `gzip` are already part of macOS.

### Windows

The project runs inside Linux, so on Windows you use WSL2 (a Linux system built into Windows).

1. Open PowerShell as Administrator and run:

   ```powershell
   wsl --install -d Ubuntu
   ```

   Reboot when asked, then open "Ubuntu" from the Start menu and choose a user name and password.
2. Install Docker Desktop: https://www.docker.com/products/docker-desktop/. During setup keep "Use WSL 2 based engine" checked.
3. In Docker Desktop, open Settings, then Resources, then WSL integration, and turn on the switch for Ubuntu.
4. Give WSL enough memory. Create the file `C:\Users\<your-name>\.wslconfig` with:

   ```ini
   [wsl2]
   memory=10GB
   ```

   Then run `wsl --shutdown` in PowerShell and restart Docker Desktop.
5. From now on, run every command in the **Ubuntu terminal**, not in PowerShell or CMD. Install the small tools there:

   ```bash
   sudo apt update && sudo apt install -y make curl gzip git
   ```

6. Clone the project inside the Linux file system (for example in `~/`), not under `/mnt/c/...`. Files on `/mnt/c` are many times slower for Docker.

### Check your setup

Run these three commands. Each must print a version number, not an error.

```bash
docker --version
docker compose version
make --version
```

Also check that Docker itself answers:

```bash
docker run --rm hello-world
```

## 4. Get the project

```bash
git clone https://github.com/JedidiAymen/weblogs-pipeline.git
cd weblogs-pipeline
```

Optionally create your own settings file:

```bash
cp .env.example .env
```

The project works without it. If you create it, these are the variables you can change:

| Variable | Default | Meaning |
|----------|---------|---------|
| `MYSQL_ROOT_PASSWORD` | `root` | Password of the MySQL `root` account |
| `MYSQL_HOST_PORT` | `3307` | Port of MySQL on your machine (3307 avoids a clash with a MySQL you may already have) |
| `KAFKA_TOPIC` | `web-logs` | Name of the Kafka topic between the two Flume agents |
| `REPLAY_RATE` | `500` | How many log lines per second are replayed |
| `REPLAY_LIMIT` | `0` | How many lines to replay in total (0 = everything, about 3.46 million) |

Type `make help` at any time to list every command.

## 5. Run it step by step

### Step 1: download the data

```bash
make data
```

Downloads the two NASA log files into `data/raw/` and checks them. Takes under a minute.

Expected output (end):

```
NASA_access_log_Jul95.gz: 1891714 lines
NASA_access_log_Aug95.gz: 1569898 lines
```

These two numbers add up to 3461612. Later the replayer counts 3461613, because one file has no newline at the end, so its last line is counted separately. This is normal.

### Step 2: build the image

```bash
make build
```

Builds one Docker image that contains Hadoop, Hive, Flume, Sqoop and their tools. The first time takes 10 to 30 minutes, depending on your connection. Later builds reuse the cache and take seconds.

Expected output (end):

```
 ✔ Image weblogs/bigdata:latest    Built
 ✔ Image weblogs/dashboard:latest  Built
```

If the download is interrupted, run `make build` again: it continues where it stopped.

### Step 3: start the services

```bash
make up
make status
```

`make up` starts every container except the replayer. `make status` shows their state. Allow 2 to 3 minutes: the first start of Hive creates its metastore schema.

Expected output of `make status` (shortened):

```
NAME            STATUS
zookeeper       Up
kafka           Up (healthy)
kafka-init      Exited (0)
mysql           Up (healthy)
hadoop          Up (healthy)
hive            Up (healthy)
flume-agent1    Up (healthy)
flume-agent2    Up (healthy)
client          Up
dashboard       Up (healthy)
```

`kafka-init` is meant to stop with `Exited (0)`: it only creates the Kafka topic. Run `make status` again until every other service says `Up`, with `(healthy)` where shown.

### Step 4: replay the logs

```bash
make replay
```

Starts the replayer, which writes the NASA log lines into the log file watched by Flume, at `REPLAY_RATE` lines per second.

How long it takes:

- Default (500 lines/s): about 2 hours for all 3.46 million lines.
- Demo speed: set `REPLAY_RATE=5000` in `.env`, about 12 minutes.
- Quick sample: set `REPLAY_LIMIT=200000` in `.env`, about 1 minute at 5000 lines/s.

Change `.env` before running `make replay`. Follow the progress with:

```bash
make logs
```

Expected lines (press Ctrl+C to stop following; the replay keeps running):

```
16:10:01 [INFO]  352000 lines written, 5007 lines/s
```

### Step 5: look at the data on its way

```bash
make topic-peek
```

Prints 5 messages read from the Kafka topic, so you can see log lines passing through Kafka. A few seconds.

```
timestamp=804556806000 | unicomp6.unicomp.net - - [01/Jul/1995:00:00:06 -0400] "GET /shuttle/countdown/ HTTP/1.0" 200 3985
timestamp=804556811000 | 199.120.110.21 - - [01/Jul/1995:00:00:11 -0400] "GET /shuttle/missions/sts-73/sts-73-patch-small.gif HTTP/1.0" 200 4179
...
```

Each message is the log line plus a `timestamp` header: the request time in milliseconds, which Flume agent 1 read from the line. Flume agent 2 uses it to pick the day folder in HDFS.

```bash
make hdfs-ls
```

Lists the day folders that Flume has written into HDFS, with their size. A few seconds.

```
6.8 M  6.8 M  /data/weblogs/dt=1995-07-01
6.4 M  6.4 M  /data/weblogs/dt=1995-07-02
...
```

Each line is one day: its size, its size on disk, and the folder.

You can also browse them at http://localhost:9870 (Utilities, then Browse the file system).

![HDFS file browser showing the day partitions dt=1995-07-01 to dt=1995-08-31](assets/screenshots/hdfs-browser.png)

### Step 6: check that nothing was lost

Wait about 1 minute after the replay ends, so Flume closes its last files, then run:

```bash
make counts
```

Compares the number of lines replayed with the number of lines stored in HDFS. Under a minute.

```
17:20:06 [INFO]  lines in source log : 3461613
17:20:06 [INFO]  lines in HDFS       : 3461613
17:20:06 [INFO]  OK: no lines lost
```

### Step 7: run the batch analysis

```bash
make pipeline
```

Runs four steps in order: create the Hive tables, import the status code reference table from MySQL into HDFS with Sqoop, run the Hive analytical queries (MapReduce jobs), and export the results back to MySQL with Sqoop. About 8 to 10 minutes on the full data. You can watch the jobs at http://localhost:8088.

![YARN ResourceManager listing the finished MapReduce applications](assets/screenshots/yarn-apps.png)

Then open MySQL and query a result table:

```bash
make mysql
```

```sql
SELECT * FROM status_distribution WHERE status IN (404, 500);
```

Expected output:

```
+--------+-----------------------+--------------+-------+--------+
| status | label                 | category     | hits  | pct    |
+--------+-----------------------+--------------+-------+--------+
|    404 | Not Found             | Client error | 20871 | 0.6029 |
|    500 | Internal Server Error | Server error |    65 | 0.0019 |
+--------+-----------------------+--------------+-------+--------+
```

Type `exit` to leave MySQL.

### Step 8: open the dashboard (or drive everything from it)

```bash
make dashboard
```

Opens http://localhost:3030 (or open it yourself in a browser). It has three pages:

- **Overview**: the key numbers of the dataset and of the pipeline.
- **Analytics**: the results of the Hive analysis, read from MySQL.
- **Live pipeline**: run controls, the live flow of every stage, Kafka lag, the current run and its log.

**Everything from the browser.** Steps 4, 6 and 7 can also be run from the *Live pipeline* page, with no terminal:

1. In **Replay the logs**, pick a rate (5K/s replays everything in about 12 minutes) and *Full dataset*, then click **Start replay**.
2. When the replayer stops, click **Run no-loss check**.
3. Click **Run batch pipeline**, or open the arrow next to it to run a single step.

While a job runs, the page shows which step is running and for how long, the MapReduce jobs on YARN with their progress, and the output of the scripts as it is written. **Stop** ends the current job. Only one job runs at a time, and the buttons are disabled while a replay started with `make replay` is running, so the two ways never collide.

![Dashboard Overview page with the key figures of the dataset](assets/screenshots/dashboard-overview.png)

![Dashboard Analytics page with charts of the Hive results](assets/screenshots/dashboard-analytics.png)

![Live pipeline page: run controls, the flow of every stage and the current run](assets/screenshots/dashboard-pipeline.png)

## 6. Five-minute live demo

Prepare before the presentation: `make up`, wait for all services to be healthy, and run `make pipeline` once so the Analytics page has results. Set `REPLAY_RATE=5000` in `.env`.

1. **(30 s) Show the dashboard Overview page.** Say: "This is a full Hadoop pipeline running on my laptop in Docker: Flume, Kafka, HDFS, Hive, Sqoop and MySQL."
2. **(30 s) Run `make replay`, then `make logs`.** Say: "This replays real NASA server logs from 1995 as if they were live traffic, here at 5000 lines per second."
3. **(30 s) Run `make topic-peek`.** Say: "The first Flume agent tails the log file and publishes each line into a Kafka topic. Here are messages read straight from Kafka."
4. **(30 s) Open http://localhost:9870 and browse the day folders.** Say: "The second Flume agent reads Kafka and writes into HDFS, one folder per day."
5. **(60 s) Open the dashboard Pipeline page, then run `docker compose stop flume-agent2`.** Say: "I stop the agent that writes into HDFS. Watch the Kafka lag: it grows, because messages pile up in Kafka instead of being lost."
6. **(45 s) Run `docker compose start flume-agent2`.** Say: "I start it again. It resumes from its last offset and the lag goes back to 0. This proves that Kafka decouples the producer from the consumer."
7. **(30 s) Run `make counts` (after the replay ends) or show its earlier result.** Say: "Every line from the source is in HDFS. Nothing was lost, even with the outage."
8. **(45 s) Show the Analytics page and the `status_distribution` query in MySQL.** Say: "Hive turned the raw logs into statistics with MapReduce, and Sqoop exported them to MySQL, where the dashboard reads them."

## 7. Stop, restart, reset

| Command | What it does |
|---------|--------------|
| `make down` | Stops every container. Your data (HDFS, Kafka, MySQL) is kept. |
| `make up` | Starts everything again, with the data from last time. |
| `make clean` | Stops everything and deletes all data volumes (HDFS, Kafka, MySQL). The next replay starts from zero. |

The downloaded files in `data/raw/` and the built image are kept in all cases.

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `port is already allocated` or `address already in use` on `make up` | Another program uses one of the ports (3030, 3307, 8088, 9870, 10002, 19888...) | Stop that program, or change `DASHBOARD_HOST_PORT` or `MYSQL_HOST_PORT` in `.env`. Find the culprit with `sudo lsof -i :<port>` |
| `hive` shows `(health: starting)` or `unhealthy` for a few minutes on the first start | Hive is creating its metastore schema in MySQL | Wait 2 to 3 minutes and run `make status` again. If it stays unhealthy, run `docker compose logs hive` |
| MapReduce jobs stay in `ACCEPTED` forever | YARN has no usable node | Open http://localhost:8088/cluster/nodes. If the node is `UNHEALTHY`, the disk is too full: free space (YARN needs more than 2 GB free). Otherwise Docker has too little memory: give it at least 8 GB |
| `make data` fails | A download mirror is down or blocked | Download `NASA_access_log_Jul95.gz` and `NASA_access_log_Aug95.gz` manually in a browser (for example from the Internet Traffic Archive) and put them in `data/raw/`, then run `make data` again |
| `make build` is very slow or stops | Slow Apache mirror or network drop | Run `make build` again: downloads resume and finished layers are cached |
| `permission denied ... docker.sock` | Your user is not in the `docker` group (Linux) | `sudo usermod -aG docker $USER`, then log out and back in |
| Containers die or WSL freezes on Windows | WSL2 runs out of memory | Set `memory=10GB` in `C:\Users\<your-name>\.wslconfig`, run `wsl --shutdown`, restart Docker Desktop |
| `make counts` shows fewer lines in HDFS right after the replay | Flume has not closed its last files yet (files whose name starts with `_` are still open and not counted) | Wait about 1 minute and run `make counts` again |

## 9. Where to go next

- [docs/PROJECT_EXPLAINED.md](PROJECT_EXPLAINED.md): how every part works and why it was built this way.
- [docs/report.pdf](report.pdf): the written project report.
- [docs/slides.pdf](slides.pdf): the presentation slides.
