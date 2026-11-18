# Entry point for every step of the pipeline. Run `make help` for the list.

COMPOSE := docker compose
CLIENT  := $(COMPOSE) exec -T client
PROJECT := /opt/project
TOPIC   ?= web-logs
DOCS_BUILD := docs/build

.DEFAULT_GOAL := help
.PHONY: help data build up replay status topic-peek hdfs-ls counts \
        hive-tables sqoop-import hive-analysis sqoop-export pipeline \
        dashboard beeline mysql shell logs lint screenshots docs down clean

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[a-z-]+:.*## / {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ---- Setup -------------------------------------------------------------------
data: ## Download the NASA logs into data/raw
	./scripts/get-data.sh

build: ## Build the Hadoop/Hive/Flume/Sqoop image
	$(COMPOSE) build

up: ## Start every service except the replayer
	$(COMPOSE) up -d

# ---- Ingestion ---------------------------------------------------------------
replay: ## Start replaying the logs (REPLAY_RATE, REPLAY_LIMIT in .env)
	$(COMPOSE) --profile replay up -d replayer

status: ## Show container state
	$(COMPOSE) ps -a

topic-peek: ## Print five independent Kafka JSON events
	$(COMPOSE) exec -T kafka kafka-console-consumer --bootstrap-server kafka:9092 --topic $(TOPIC) --from-beginning --max-messages 5

hdfs-ls: ## List the day partitions written to HDFS
	$(CLIENT) hdfs dfs -du -h /data/nasa

counts: ## Compare replayed lines with lines stored in HDFS
	$(CLIENT) bash $(PROJECT)/scripts/check-counts.sh

# ---- Analysis and export -----------------------------------------------------
hive-tables: ## Create the Hive database, tables and view
	$(CLIENT) bash $(PROJECT)/scripts/run-hive.sh $(PROJECT)/hive/01_create_tables.sql

sqoop-import: ## Import MySQL status_codes into HDFS
	$(CLIENT) bash $(PROJECT)/sqoop/import_status_codes.sh

hive-analysis: ## Run the analytical queries
	$(CLIENT) bash $(PROJECT)/scripts/run-hive.sh $(PROJECT)/hive/02_analysis.sql

sqoop-export: ## Export the Hive results to MySQL
	$(CLIENT) bash $(PROJECT)/sqoop/export_results.sh

pipeline: ## Run verified batch steps
	$(MAKE) hive-tables
	$(MAKE) sqoop-import
	$(MAKE) verify-ingestion
	$(MAKE) hive-analysis
	$(MAKE) sqoop-export


# ---- Tools -------------------------------------------------------------------
dashboard: ## Open the web dashboard (http://localhost:3030)
	@url=http://localhost:$${DASHBOARD_HOST_PORT:-3030}; echo "Dashboard: $$url"; \
	  (xdg-open $$url || open $$url) >/dev/null 2>&1 || true

beeline: ## Open a Hive SQL shell
	$(CLIENT) beeline -u jdbc:hive2://hive:10000/weblogs -n hadoop

mysql: ## Open a MySQL shell on the weblogs database
	$(COMPOSE) exec mysql mysql -usqoop -psqoop weblogs

shell: ## Open a shell in the client container
	$(CLIENT) bash

logs: ## Follow the logs of the ingestion services
	$(COMPOSE) logs -f --tail=50 replayer flume-agent1 kafka-producer kafka-hdfs-writer

lint: ## Check shell scripts, the dashboard and the docs build
	docker run --rm -v "$(CURDIR):/mnt:ro" -w /mnt koalaman/shellcheck:stable \
		scripts/*.sh scripts/lib/common.sh sqoop/*.sh docker/bigdata/*.sh docker/bigdata/roles/*.sh
	cd dashboard && npm ci --no-audit --no-fund && npx next typegen && npx tsc --noEmit && npm run lint
	cd $(DOCS_BUILD) && npm ci --no-audit --no-fund && npm run typecheck

# ---- Report and slides (need Node.js 20+ on the host and a completed pipeline) ----
$(DOCS_BUILD)/node_modules: $(DOCS_BUILD)/package.json
	cd $(DOCS_BUILD) && npm ci --no-audit --no-fund && touch node_modules

screenshots: $(DOCS_BUILD)/node_modules ## Capture dashboard, HDFS, YARN and terminal screenshots
	cd $(DOCS_BUILD) && npm run capture

docs: $(DOCS_BUILD)/node_modules ## Build docs/report.pdf and docs/slides.pdf
	cd $(DOCS_BUILD) && npm run render

down: ## Stop everything, keep the data
	$(COMPOSE) --profile replay down

clean: ## Stop everything and delete all volumes (HDFS, Kafka, MySQL)
	$(COMPOSE) --profile replay down -v

.PHONY: ingest-flume ingest-kafka ingest-sqoop pipeline-parallel verify-ingestion analyze export-results test-regression
.PHONY: benchmark-small benchmark-medium benchmark-stress experiment-kafka-recovery verify-analytics
ingest-flume: ## Replay canonical raw logs independently
	$(COMPOSE) up -d hadoop flume-agent1
	$(COMPOSE) run --rm replayer
ingest-kafka: ## Publish structured events independently
	$(COMPOSE) up -d kafka-hdfs-writer
	$(COMPOSE) run --rm kafka-producer
ingest-sqoop: sqoop-import ## Import relational reference data independently
verify-ingestion: ## Save source-aware verification; unknown is a failure
	$(CLIENT) python3 $(PROJECT)/scripts/verify_ingestion.py
pipeline-parallel: ## Concurrent ingress, verify, analyze, export
	$(CLIENT) python3 $(PROJECT)/scripts/parallel_ingestion.py
	$(MAKE) pipeline
analyze: hive-analysis ## Run canonical Hive analysis
export-results: sqoop-export ## Export reporting tables
test-regression: ## Lightweight fixture regression suite
	python3 -m unittest discover -s tests -v

benchmark-small: ## Measure 100 events/s requested rate, preserving checkpoints
	python3 scripts/benchmark.py --rate 100
benchmark-medium: ## Measure 1000 events/s requested rate
	python3 scripts/benchmark.py --rate 1000 --limit 20000
benchmark-stress: ## Measure 5000 events/s requested rate
	python3 scripts/benchmark.py --rate 5000 --limit 30000
experiment-kafka-recovery: ## Pause writer, observe isolation, resume and reconcile
	python3 scripts/experiment.py

verify-analytics: ## Compare full reporting results with historical NASA baseline
	$(CLIENT) python3 $(PROJECT)/scripts/verify_analytics.py
