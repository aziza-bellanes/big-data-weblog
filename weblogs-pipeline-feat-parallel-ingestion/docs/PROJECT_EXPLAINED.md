# Parallel ingestion architecture

Flume tails raw logs directly into HDFS. A separate Kafka producer reads the NASA dataset, and a dedicated consumer writes JSONL to a separate HDFS zone. Sqoop independently imports MySQL reference rows. None of the three paths transports another branch's payload.

Hive canonical analytics read nasa_logs_raw only, join status_codes, and retain the original six outputs. Sqoop exports those outputs to MySQL, and the dashboard reads MySQL. Kafka is an alternate representation, with a unique-event view for at-least-once recovery.

See the [current contracts, commands and limitations](../README.md) and [validation evidence](MIGRATION_VALIDATION.md). The prior sequential guides are archived under legacy/.
