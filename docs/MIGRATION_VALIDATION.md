# Migration validation

The implementation is present, but the complete migration acceptance gates have **not** been demonstrated on a running Hadoop cluster.

Completed locally:

* `docker compose config --quiet` passes.
* Eleven Python fixture tests pass, including historical server dates, malformed input preservation, stable identities, repeated requests, replay resume, hidden upload/rename ordering, failed-upload handling, commit-after-publication ordering, concurrent independent controls and conflicting rerun rejection.
* Python compilation and Bash syntax checks pass.
* Dashboard production build and TypeScript checks pass. Fonts are now bundled locally.
* Documentation generator TypeScript check passes.
* Architecture PNG/SVG were regenerated from the parallel topology source.

Runtime limitation: no stack or NASA dataset was present. The image's Python dependencies installed successfully, but downloading the existing 696 MB Hadoop release was limited to approximately 100 KB/s on the first mirror and about 20 KB/s on the fallback. These build attempts were stopped; no application containers or volumes were removed. Consequently no HDFS/Flume integration, live Kafka crash experiment, Hive/Sqoop end-to-end run, full-dataset regression or measured performance result is claimed.

After the image and dataset are available:

1. Run the fixture through each branch separately, with the other two ingestion components stopped. Keep the fixture dataset and producer state separate from the full NASA deployment.
2. Run all three branches concurrently; inspect per-branch logs and HDFS destinations.
3. Run `make verify-ingestion`. It waits for closed files, compares raw content multiplicities, compares Kafka logical IDs with acknowledged source identities, measures physical duplicates separately and compares reference contents with MySQL. Unavailable measurements fail verification.
4. Run `make pipeline`, then `make verify-analytics` after a full original-dataset replay. Expected baseline values are assertions, never substituted for observed counts.
5. With both replays active, run `make experiment-kafka-recovery`. Insufficient traffic yields INCONCLUSIVE; no fixture execution is represented as a full-dataset recovery result.
6. Run a benchmark preset in an isolated fresh deployment. Save the actual JSON/CSV and hardware configuration. Scripts preserve existing checkpoints; later presets use larger cumulative limits.
7. Capture new screenshots and regenerate PDFs. PDF generation requires successful verification and regression artifacts; old PDFs/screenshots are historical evidence only.

Remaining operational limits:

* Kafka delivery is at least once. A crash after HDFS publication and before offset commit can create duplicate event IDs, excluded by the Hive unique-event view. Hidden incomplete Kafka files may remain after crashes and require manual cleanup after inspection.
* Sqoop snapshot publication uses a recoverable backup/rename pair. It is not an atomic directory exchange; readers can briefly see the final directory missing. A retry restores an interrupted backup before importing.
* Flume's canonical raw stream has no per-line source IDs; verification compares raw content multiplicities with the replayed file. This detects gaps and duplicates but is not a proof of exactly-once crash behavior.
* The current writer batches up to 1,000 messages. On a tiny laptop or low-rate demonstration this can create many small HDFS files; adjust batching only after measuring the runtime.
* UI writer event counters describe the current process session. Kafka offsets and verification artifacts carry durable progress. Metrics may be unknown while a service is unreachable.
* Host-side experiments/benchmarks require Python 3, Docker Compose and the running dashboard. Heavy integration and full-data suites are local tasks; CI covers only fixtures and configuration.
* Prometheus/Grafana, anomaly detection, additional automated fault scenarios and a dedicated Experiments UI remain optional extensions. Existing reporting charts and SQL outputs are preserved.

Library behavior was checked against the [Confluent Python client documentation](https://docs.confluent.io/kafka-clients/python/current/overview.html) and the [Apache Flume user guide](https://flume.apache.org/FlumeUserGuide.html). Installed Kafka client is pinned to 2.6.1; actual pinned Hadoop/Flume compatibility still requires the runtime checks above.
