# Entry point for every step of the pipeline. Run `make help` for the list.
#
# Three ingestion branches start together and each one ends in HDFS:
#   Flume   live log -> HDFS raw lines (batch layer, analysed by Hive)
#   Kafka   topic web-events -> HDFS JSON events, and -> Spark speed layer -> HDFS Parquet
#   Sqoop   MySQL status_codes -> HDFS reference data
# Folders, topic and databases are in config/architectures.json.

COMPOSE := docker compose
PROJECT := /opt/project
DOCS_BUILD := docs/build
DOCS_RUN = PROJECT_DIR="$(CURDIR)" $(COMPOSE) -f docker-compose.yml -f docker-compose.docs.yml run --rm --no-deps -T docs

-include .env
CLIENT := $(COMPOSE) exec -T client
# Everything runs in containers; only Docker and make are needed on the host.
# $(call setting,KEY) reads one setting of config/architectures.json, inside the client container.
setting = $(shell $(COMPOSE) exec -T client python3 $(PROJECT)/scripts/architectures.py get parallel $(1))
# One-off container from the same image, for commands that need no running stack.
RUN := $(COMPOSE) run --rm --no-deps -T -w $(PROJECT) client

# Short replay settings: make replay RATE=5000 LIMIT=200000
RATE  ?= 5000
LIMIT ?= 0
# Preserve .env defaults unless RATE or LIMIT is given.
ifneq ($(origin RATE),file)
REPLAY_RATE := $(RATE)
endif
ifneq ($(origin LIMIT),file)
REPLAY_LIMIT := $(LIMIT)
endif
export REPLAY_RATE REPLAY_LIMIT

.DEFAULT_GOAL := help
.PHONY: help data build up db-init replay status topic-peek hdfs-ls counts verify-ingestion study \
        hive-tables sqoop-import hive-analysis speed-layer speed-layer-hive sqoop-export pipeline runs reset \
        ingest-flume ingest-kafka ingest-sqoop pipeline-parallel verify-analytics \
        experiment-kafka-recovery benchmark-small benchmark-medium benchmark-stress \
        test-regression dashboard beeline mysql shell logs lint screenshots docs down clean

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[a-z-]+:.*## / {printf "  \033[36m%-26s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ---- Setup -------------------------------------------------------------------
data: ## Download the NASA logs into data/raw
	./scripts/get-data.sh

build: ## Build the Hadoop/Hive/Flume/Sqoop/Spark and dashboard images
	$(COMPOSE) build

up: ## Start every service except the replayer
	mkdir -p artifacts
	$(COMPOSE) up -d --remove-orphans

db-init: ## Create the MySQL database and its tables, speed layer included (safe to repeat)
	$(COMPOSE) exec -T mysql sh -c 'mysql -uroot -p"$$MYSQL_ROOT_PASSWORD" < /docker-entrypoint-initdb.d/01_databases_users.sql \
	  && mysql -uroot -p"$$MYSQL_ROOT_PASSWORD" weblogs_parallel < /opt/mysql/schema/weblogs.sql \
	  && mysql -uroot -p"$$MYSQL_ROOT_PASSWORD" weblogs_parallel < /opt/mysql/schema/speed_layer.sql'

# ---- Ingestion ---------------------------------------------------------------
replay: ## Start the three ingestion branches in the background (REPLAY_RATE, REPLAY_LIMIT)
	$(COMPOSE) --profile replay up -d replayer kafka-producer
	$(CLIENT) bash $(PROJECT)/sqoop/import_status_codes.sh

status: ## Show container state
	$(COMPOSE) ps -a

topic-peek: ## Print 5 JSON events from the Kafka topic
	@$(COMPOSE) exec -T kafka kafka-console-consumer --bootstrap-server kafka:9092 \
		--topic $(call setting,kafkaTopic) --from-beginning --max-messages 5 2>/dev/null

hdfs-ls: ## List the HDFS zones of the Flume, Kafka and Spark outputs
	$(CLIENT) hdfs dfs -du -h $(call setting,rawDir) $(call setting,eventsDir) $(call setting,speedDir)

counts: ## Compare replayed lines with lines stored in HDFS
	$(CLIENT) bash $(PROJECT)/scripts/check-counts.sh

verify-ingestion: ## Check each branch against its source (lines, event IDs, Spark progress, rows)
	$(CLIENT) python3 $(PROJECT)/scripts/verify_ingestion.py

# ---- Analysis and export -----------------------------------------------------
hive-tables: ## Create the Hive database, tables and views
	$(CLIENT) bash $(PROJECT)/scripts/run-hive.sh $(PROJECT)/hive/01_create_tables.sql \
		$(PROJECT)/hive/03_kafka_events.sql $(PROJECT)/hive/04_speed_layer.sql

sqoop-import: ## Import MySQL status_codes into HDFS
	$(CLIENT) bash $(PROJECT)/sqoop/import_status_codes.sh

hive-analysis: ## Run the analytical queries, then check the speed layer against them
	$(CLIENT) bash $(PROJECT)/scripts/run-hive.sh $(PROJECT)/hive/02_analysis.sql $(PROJECT)/hive/05_speed_check.sql

speed-layer: ## Live figures written by Spark so far (latest minutes and alerts, from MySQL)
	$(COMPOSE) exec -T mysql mysql -usqoop -psqoop weblogs_parallel -e \
		'SELECT COUNT(*) AS batches, SUM(events) AS events, MAX(processed_at) AS last_batch FROM speed_batches; \
		 SELECT * FROM speed_minute ORDER BY minute DESC LIMIT 10; \
		 SELECT minute, kind, subject, value, threshold FROM speed_alerts ORDER BY minute DESC LIMIT 20;'

speed-layer-hive: ## The same alerts read by Hive from Spark's Parquet files in HDFS
	$(COMPOSE) exec -T client beeline -u jdbc:hive2://hive:10000/weblogs_parallel -n hadoop --silent=true \
		-e 'MSCK REPAIR TABLE speed_minute_parts SYNC PARTITIONS; MSCK REPAIR TABLE speed_host_minute_parts SYNC PARTITIONS; \
		    SELECT * FROM speed_alerts ORDER BY minute;'

sqoop-export: ## Export the Hive results to MySQL
	$(CLIENT) bash $(PROJECT)/sqoop/export_results.sh

# The Sqoop import is an ingestion branch (make replay ran it); the batch part reconciles
# the three branches instead, and the analysis ends with the speed-vs-batch check.
pipeline: hive-tables verify-ingestion hive-analysis sqoop-export ## Run every batch step in order

runs: ## List the recorded runs
	@$(COMPOSE) exec -T client curl -fs http://localhost:8000/runs

reset: ## Empty the ingested data and results (live log, HDFS zones, MySQL results and speed tables)
	@printf 'This deletes the ingested data and results. Continue? [y/N] '; read answer; [ "$$answer" = y ]
	$(CLIENT) python3 $(PROJECT)/scripts/reset_architecture.py parallel

# ---- Branch by branch ------------------------------------------------------------
ingest-flume: ## Replay into the live log of the Flume branch only
	$(COMPOSE) --profile replay up -d replayer

ingest-kafka: ## Publish the JSON events of the Kafka branch only
	$(COMPOSE) --profile replay up -d kafka-producer

ingest-sqoop: ## Run the Sqoop branch only
	$(MAKE) sqoop-import

pipeline-parallel: ## Run the three branches together (foreground), then the batch part
	$(COMPOSE) exec -T client python3 $(PROJECT)/scripts/parallel_ingestion.py
	$(MAKE) pipeline

verify-analytics: ## Check the MySQL results against the full-dataset baseline
	$(CLIENT) python3 $(PROJECT)/scripts/verify_analytics.py

experiment-kafka-recovery: ## Pause the Kafka HDFS writer during an ingestion, then reconcile
	./scripts/experiment-kafka-recovery.sh

benchmark-small: ## Three branches at 100 lines/s (cumulative limit 10,000)
	$(COMPOSE) exec -T client python3 $(PROJECT)/scripts/benchmark.py --rate 100
benchmark-medium: ## Three branches at 1,000 lines/s (cumulative limit 20,000)
	$(COMPOSE) exec -T client python3 $(PROJECT)/scripts/benchmark.py --rate 1000 --limit 20000
benchmark-stress: ## Three branches at 5,000 lines/s (cumulative limit 30,000)
	$(COMPOSE) exec -T client python3 $(PROJECT)/scripts/benchmark.py --rate 5000 --limit 30000

test-regression: ## Unit tests on a 100-line fixture (no running stack needed)
	$(RUN) python3 -B -m unittest discover -s tests -v

# ---- Tools -------------------------------------------------------------------
dashboard: ## Open the web dashboard (http://localhost:3030)
	@url=http://localhost:$${DASHBOARD_HOST_PORT:-3030}; echo "Dashboard: $$url"; \
	  (xdg-open $$url || open $$url) >/dev/null 2>&1 || true

beeline: ## Open a Hive SQL shell
	$(COMPOSE) exec client beeline -u jdbc:hive2://hive:10000/$(call setting,hiveDb) -n hadoop

mysql: ## Open a MySQL shell
	$(COMPOSE) exec mysql mysql -usqoop -psqoop $(call setting,mysqlDb)

shell: ## Open a shell in the client container
	$(COMPOSE) exec client bash

logs: ## Follow the logs of the ingestion services
	$(COMPOSE) logs -f --tail=50 flume-direct kafka-hdfs-writer spark-streaming

lint: ## Check shell scripts, Python tests, the dashboard and the docs build
	docker run --rm -v "$(CURDIR):/mnt:ro" -w /mnt koalaman/shellcheck:stable \
		scripts/*.sh scripts/lib/common.sh sqoop/*.sh mysql/init/*.sh docker/bigdata/*.sh docker/bigdata/roles/*.sh
	$(MAKE) test-regression
	docker build --target build -t weblogs/dashboard-check ./dashboard
	docker run --rm weblogs/dashboard-check sh -c 'npx next typegen && npx tsc --noEmit && npm run lint'
	$(DOCS_RUN) 'npm ci --no-audit --no-fund && npm run typecheck'

# ---- Report, slides and guide (Playwright and Node run in Docker) ---------------
screenshots: ## Capture dashboard, HDFS, YARN and terminal screenshots
	$(DOCS_RUN) 'npm ci --no-audit --no-fund && npm run capture'

docs: ## Build docs/report.pdf, docs/slides.pdf and docs/guide.pdf
	$(DOCS_RUN) 'npm ci --no-audit --no-fund && npm run render'

study: ## Build the complete project walkthrough and recording checklist PDF
	$(DOCS_RUN) 'npm ci --no-audit --no-fund && npm run study'

down: ## Stop everything, keep the data
	$(COMPOSE) --profile replay down

clean: ## Stop everything and delete all volumes (HDFS, Kafka, MySQL, runs)
	$(COMPOSE) --profile replay down -v
