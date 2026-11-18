# Entry point for every step of the pipeline. Run `make help` for the list.
#
# Two architectures share the cluster (config/architectures.json); pick one with ARCH:
#   ARCH=parallel    B · Parallel   (default) Flume, Kafka and Sqoop ingest side by side
#   ARCH=sequential  A · Sequential Flume -> Kafka -> Flume, one chain

COMPOSE := docker compose
PROJECT := /opt/project
DOCS_BUILD := docs/build
DOCS_RUN = PROJECT_DIR="$(CURDIR)" $(COMPOSE) -f docker-compose.yml -f docker-compose.docs.yml run --rm --no-deps -T docs

-include .env
ARCH ?= parallel
ifeq ($(filter $(ARCH),parallel sequential),)
$(error ARCH must be parallel or sequential, not '$(ARCH)')
endif
CLIENT := $(COMPOSE) exec -T -e ARCH=$(ARCH) client
# Everything runs in containers; only Docker and make are needed on the host.
# $(call arch_get,KEY) reads one setting of ARCH, inside the client container.
arch_get = $(shell $(COMPOSE) exec -T client python3 $(PROJECT)/scripts/architectures.py get $(ARCH) $(1))
# One-off container from the same image, for commands that need no running stack.
RUN := $(COMPOSE) run --rm --no-deps -T -w $(PROJECT) client

# Comparison settings (make compare)
RATE  ?= 5000
LIMIT ?= 0
# Preserve .env defaults unless the short comparison-style settings are supplied.
ifneq ($(origin RATE),file)
REPLAY_RATE := $(RATE)
endif
ifneq ($(origin LIMIT),file)
REPLAY_LIMIT := $(LIMIT)
endif
export REPLAY_RATE REPLAY_LIMIT

.DEFAULT_GOAL := help
.PHONY: help data build up db-init replay status topic-peek hdfs-ls counts verify-ingestion \
        hive-tables sqoop-import hive-analysis sqoop-export pipeline compare runs reset \
        ingest-flume ingest-kafka ingest-sqoop pipeline-parallel verify-analytics \
        experiment-kafka-recovery benchmark-small benchmark-medium benchmark-stress \
        test-regression dashboard beeline mysql shell logs lint screenshots docs down clean

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[a-z-]+:.*## / {printf "  \033[36m%-26s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo "  ARCH=$(ARCH) (parallel | sequential)"

# ---- Setup -------------------------------------------------------------------
data: ## Download the NASA logs into data/raw
	./scripts/get-data.sh

build: ## Build the Hadoop/Hive/Flume/Sqoop and dashboard images
	$(COMPOSE) build

up: ## Start every service except the replayer
	mkdir -p artifacts
	$(COMPOSE) up -d

db-init: ## Create both MySQL databases and their tables (safe to repeat)
	$(COMPOSE) exec -T mysql sh -c 'mysql -uroot -p"$$MYSQL_ROOT_PASSWORD" < /docker-entrypoint-initdb.d/01_databases_users.sql \
	  && for db in weblogs weblogs_parallel; do mysql -uroot -p"$$MYSQL_ROOT_PASSWORD" "$$db" < /opt/mysql/schema/weblogs.sql || exit; done'

# ---- Ingestion ---------------------------------------------------------------
replay: ## Start the ingestion of ARCH in the background (REPLAY_RATE, REPLAY_LIMIT)
	ARCH=$(ARCH) $(COMPOSE) --profile replay up -d replayer $(if $(filter parallel,$(ARCH)),kafka-producer)
ifeq ($(ARCH),parallel)
	$(CLIENT) bash $(PROJECT)/sqoop/import_status_codes.sh
endif

status: ## Show container state
	$(COMPOSE) ps -a

# A carries Flume events (Avro: headers + body), shown as "timestamp=<ms> | <log line>";
# B carries one JSON event per line.
topic-peek: ## Print 5 messages from the Kafka topic of ARCH
	@$(COMPOSE) exec -T kafka kafka-console-consumer --bootstrap-server kafka:9092 \
		--topic $(call arch_get,kafkaTopic) --from-beginning --max-messages 5 2>/dev/null \
		| LC_ALL=C tr -c '[:print:]\n' '\001' \
		| LC_ALL=C sed -E 's/^\x01*timestamp\x01+([0-9]+)\x01+/timestamp=\1 | /'

hdfs-ls: ## List the day partitions of ARCH in HDFS
	$(CLIENT) hdfs dfs -du -h $(call arch_get,rawDir) $(call arch_get,eventsDir)

counts: ## Compare replayed lines with lines stored in HDFS (ARCH)
	$(CLIENT) bash $(PROJECT)/scripts/check-counts.sh

verify-ingestion: ## B: check each branch against its source (lines, event IDs, rows)
	$(COMPOSE) exec -T client python3 $(PROJECT)/scripts/verify_ingestion.py

# ---- Analysis and export -----------------------------------------------------
hive-tables: ## Create the Hive database, tables and views of ARCH
	$(CLIENT) bash $(PROJECT)/scripts/run-hive.sh $(PROJECT)/hive/01_create_tables.sql \
		$(if $(filter parallel,$(ARCH)),$(PROJECT)/hive/03_kafka_events.sql)

sqoop-import: ## Import MySQL status_codes into the HDFS zone of ARCH
	$(CLIENT) bash $(PROJECT)/sqoop/import_status_codes.sh

hive-analysis: ## Run the analytical queries of ARCH
	$(CLIENT) bash $(PROJECT)/scripts/run-hive.sh $(PROJECT)/hive/02_analysis.sql

sqoop-export: ## Export the Hive results of ARCH to its MySQL database
	$(CLIENT) bash $(PROJECT)/sqoop/export_results.sh

# In B the Sqoop import is an ingestion branch (make replay ran it); the batch part
# reconciles the three branches instead.
ifeq ($(ARCH),parallel)
pipeline: hive-tables verify-ingestion hive-analysis sqoop-export ## Run every batch step of ARCH in order
else
pipeline: hive-tables sqoop-import hive-analysis sqoop-export
endif

# ---- Comparison --------------------------------------------------------------
compare: ## Run A then B on the same lines (RATE, LIMIT) and compare them; empties both first
	@printf 'This empties the data of both architectures first. Continue? [y/N] '; read answer; [ "$$answer" = y ]
	$(COMPOSE) exec -T client python3 $(PROJECT)/scripts/control_client.py compare --rate $(RATE) --limit $(LIMIT)

runs: ## List the recorded runs and comparisons
	@$(COMPOSE) exec -T client curl -fs http://localhost:8000/runs

reset: ## Empty the data of ARCH (live log, HDFS zone, MySQL results)
	@printf 'This deletes the ingested data and results of $(ARCH). Continue? [y/N] '; read answer; [ "$$answer" = y ]
	$(CLIENT) python3 $(PROJECT)/scripts/reset_architecture.py $(ARCH)

# ---- Architecture B, branch by branch ------------------------------------------
ingest-flume: ## B: replay into the live log of the Flume branch only
	ARCH=parallel $(COMPOSE) --profile replay up -d replayer

ingest-kafka: ## B: publish the JSON events of the Kafka branch only
	$(COMPOSE) --profile replay up -d kafka-producer

ingest-sqoop: ## B: run the Sqoop branch only
	$(MAKE) sqoop-import ARCH=parallel

pipeline-parallel: ## B: run the three branches together (foreground), then the batch part
	$(COMPOSE) exec -T client python3 $(PROJECT)/scripts/parallel_ingestion.py
	$(MAKE) pipeline ARCH=parallel

verify-analytics: ## Check the MySQL results of ARCH against the full-dataset baseline
	$(CLIENT) python3 $(PROJECT)/scripts/verify_analytics.py

experiment-kafka-recovery: ## B: pause the Kafka HDFS writer during an ingestion, then reconcile
	./scripts/experiment-kafka-recovery.sh

benchmark-small: ## B: three branches at 100 lines/s (cumulative limit 10,000)
	$(COMPOSE) exec -T client python3 $(PROJECT)/scripts/benchmark.py --rate 100
benchmark-medium: ## B: three branches at 1,000 lines/s (cumulative limit 20,000)
	$(COMPOSE) exec -T client python3 $(PROJECT)/scripts/benchmark.py --rate 1000 --limit 20000
benchmark-stress: ## B: three branches at 5,000 lines/s (cumulative limit 30,000)
	$(COMPOSE) exec -T client python3 $(PROJECT)/scripts/benchmark.py --rate 5000 --limit 30000

test-regression: ## Unit tests on a 100-line fixture (no running stack needed)
	$(RUN) python3 -B -m unittest discover -s tests -v

# ---- Tools -------------------------------------------------------------------
dashboard: ## Open the web dashboard (http://localhost:3030)
	@url=http://localhost:$${DASHBOARD_HOST_PORT:-3030}; echo "Dashboard: $$url"; \
	  (xdg-open $$url || open $$url) >/dev/null 2>&1 || true

beeline: ## Open a Hive SQL shell on the database of ARCH
	$(COMPOSE) exec client beeline -u jdbc:hive2://hive:10000/$(call arch_get,hiveDb) -n hadoop

mysql: ## Open a MySQL shell on the database of ARCH
	$(COMPOSE) exec mysql mysql -usqoop -psqoop $(call arch_get,mysqlDb)

shell: ## Open a shell in the client container
	$(COMPOSE) exec -e ARCH=$(ARCH) client bash

logs: ## Follow the logs of the ingestion services of ARCH
	$(COMPOSE) logs -f --tail=50 $(if $(filter parallel,$(ARCH)),flume-direct kafka-hdfs-writer,flume-agent1 flume-agent2)

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

down: ## Stop everything, keep the data
	$(COMPOSE) --profile replay down

clean: ## Stop everything and delete all volumes (HDFS, Kafka, MySQL, runs)
	$(COMPOSE) --profile replay down -v
