#!/usr/bin/env python3
"""Kafka branch of the pipeline: the speed layer. Spark Structured Streaming reads topic
web-events while Flume is still collecting, and every 5 s micro-batch writes per-minute
figures to two places:

    HDFS Parquet (the record, read by Hive: hive/04_speed_layer.sql)
        <speedDir>/minute_stats/batch_id=N   hits, 4xx, 404, 5xx and bytes per minute
        <speedDir>/host_minute/batch_id=N    requests per host and minute
    MySQL (serving tables for the dashboard: mysql/schema/speed_layer.sql)
        speed_minute, speed_host_minute      running totals
        speed_alerts                         minutes above the alert thresholds
        speed_batches                        one row per applied micro-batch

Exactly once. After a crash Spark replays the last micro-batch with the same id and the
same Kafka offsets: its HDFS folder is overwritten with the same content, and MySQL skips
it because its batch_id is already in speed_batches (written in the same transaction as
the totals). The read position lives in the Spark checkpoint, outside speedDir, so
`make reset` empties the output without making Spark read earlier runs again. On its very
first start Spark begins at the end of the topic.

Run with spark-submit (service spark-streaming).
"""
import os
import time
from pathlib import Path

import architectures

ARCH = architectures.get('parallel')
OUTPUT = ARCH['speedDir']
CHECKPOINT = ARCH['speedCheckpoint']
TRIGGER = '5 seconds'
MAX_EVENTS_PER_BATCH = 200000
# Written once the query has run its first trigger, i.e. once its starting Kafka offsets
# are fixed in the checkpoint; the container healthcheck waits for it.
READY = Path('/tmp/speed-layer.ready')

# Alert thresholds per minute, above the 99.9th percentile of a normal NASA minute
# (217 hits, 13 not-found, 16 requests from one host). Same numbers in hive/04_speed_layer.sql.
MINUTE_ALERTS = (('traffic_spike', 'hits', 300), ('not_found_burst', 'not_found', 15),
                 ('server_errors', 'server_errors', 3))
HOST_FLOOD = 30


def event_schema():
    from pyspark.sql import types as T
    return T.StructType([T.StructField(name, kind) for name, kind in (
        ('event_id', T.StringType()), ('event_time', T.StringType()), ('dt', T.StringType()),
        ('host', T.StringType()), ('resource', T.StringType()),
        ('http_status', T.IntegerType()), ('bytes', T.LongType()),
        ('parse_error', T.StringType()))])


def parsed(events):
    """Well-formed events with their server-local minute, e.g. '1995-07-01 00:00'.

    The producer keeps the log's own UTC offset in event_time, so its first 16 characters
    are the local minute, the same clock as the Hive analysis of the Flume lines.
    """
    from pyspark.sql import functions as F
    return (events.where(F.col('parse_error').isNull())
            .withColumn('minute', F.regexp_replace(F.substring('event_time', 1, 16), 'T', ' ')))


def minute_stats(events):
    from pyspark.sql import functions as F
    status = F.col('http_status')

    def count_if(condition):
        return F.sum(F.when(condition, 1).otherwise(0)).cast('long')
    return (parsed(events).groupBy('dt', 'minute')
            .agg(F.count(F.lit(1)).alias('hits'),
                 count_if(status.between(400, 499)).alias('client_errors'),
                 count_if(status == 404).alias('not_found'),
                 count_if(status >= 500).alias('server_errors'),
                 F.sum(F.coalesce('bytes', F.lit(0))).cast('long').alias('bytes')))


def host_minute(events):
    from pyspark.sql import functions as F
    return parsed(events).groupBy('dt', 'minute', 'host').agg(F.count(F.lit(1)).alias('hits'))


def write_batch(batch, batch_id):
    from pyspark.sql import functions as F
    events = (batch.select(F.from_json(F.col('value').cast('string'), event_schema()).alias('e'))
              .select('e.*').persist())
    try:
        minutes, hosts = minute_stats(events), host_minute(events)
        for name, frame in (('minute_stats', minutes), ('host_minute', hosts)):
            frame.coalesce(1).write.mode('overwrite').parquet(f'{OUTPUT}/{name}/batch_id={batch_id}')
        # Partial counts of one micro-batch are small (a few thousand rows at most).
        applied = serve(batch_id, events.count(), minutes.collect(), hosts.collect())
        print(f'batch {batch_id}: {"applied" if applied else "already applied, skipped"}', flush=True)
    finally:
        events.unpersist()


def serve(batch_id, events, minutes, hosts):
    """Add one micro-batch to the MySQL totals and refresh the alerts of the minutes it touched,
    in one transaction. Returns False when this batch_id was applied before."""
    import pymysql
    connection = pymysql.connect(host=os.environ.get('MYSQL_HOST', 'mysql'),
                                 user=os.environ.get('SQOOP_DB_USER', 'sqoop'),
                                 password=os.environ.get('SQOOP_DB_PASSWORD', 'sqoop'),
                                 database=ARCH['mysqlDb'], autocommit=False)
    try:
        with connection.cursor() as cursor:
            cursor.execute('SELECT 1 FROM speed_batches WHERE batch_id = %s FOR UPDATE', (batch_id,))
            if cursor.fetchone():
                connection.rollback()
                return False
            cursor.executemany(
                'INSERT INTO speed_minute (minute, day, hits, client_errors, not_found, server_errors, bytes) '
                'VALUES (%s, %s, %s, %s, %s, %s, %s) ON DUPLICATE KEY UPDATE '
                'hits = hits + VALUES(hits), client_errors = client_errors + VALUES(client_errors), '
                'not_found = not_found + VALUES(not_found), server_errors = server_errors + VALUES(server_errors), '
                'bytes = bytes + VALUES(bytes)',
                [(r.minute, r.dt, r.hits, r.client_errors, r.not_found, r.server_errors, r.bytes) for r in minutes])
            cursor.executemany(
                'INSERT INTO speed_host_minute (minute, host, hits) VALUES (%s, %s, %s) '
                'ON DUPLICATE KEY UPDATE hits = hits + VALUES(hits)',
                [(r.minute, r.host, r.hits) for r in hosts])
            touched = sorted({r.minute for r in minutes})
            if touched:
                within = ', '.join(['%s'] * len(touched))
                for kind, column, threshold in MINUTE_ALERTS:
                    cursor.execute(
                        f'INSERT INTO speed_alerts (minute, kind, subject, value, threshold) '
                        f"SELECT minute, %s, '', {column}, %s FROM speed_minute "
                        f'WHERE minute IN ({within}) AND {column} >= %s '
                        f'ON DUPLICATE KEY UPDATE value = VALUES(value)',
                        (kind, threshold, *touched, threshold))
                cursor.execute(
                    f'INSERT INTO speed_alerts (minute, kind, subject, value, threshold) '
                    f"SELECT minute, 'host_flood', host, hits, %s FROM speed_host_minute "
                    f'WHERE minute IN ({within}) AND hits >= %s '
                    f'ON DUPLICATE KEY UPDATE value = VALUES(value)',
                    (HOST_FLOOD, *touched, HOST_FLOOD))
            cursor.execute(
                'INSERT INTO speed_batches (batch_id, events, parsed, first_minute, last_minute) '
                'VALUES (%s, %s, %s, %s, %s)',
                (batch_id, events, sum(r.hits for r in minutes),
                 touched[0] if touched else None, touched[-1] if touched else None))
        connection.commit()
        return True
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def main():
    from pyspark.sql import SparkSession
    READY.unlink(missing_ok=True)
    spark = (SparkSession.builder.appName('speed-layer')
             .config('spark.sql.shuffle.partitions', '4')
             .config('spark.ui.showConsoleProgress', 'false')
             .getOrCreate())
    spark.sparkContext.setLogLevel('WARN')
    stream = (spark.readStream.format('kafka')
              .option('kafka.bootstrap.servers', os.environ.get('KAFKA_BOOTSTRAP_SERVERS', 'kafka:9092'))
              .option('subscribe', ARCH['kafkaTopic'])
              .option('startingOffsets', 'latest')
              .option('maxOffsetsPerTrigger', MAX_EVENTS_PER_BATCH)
              # A topic recreated with its volume is behind the checkpoint: go on, do not stop.
              .option('failOnDataLoss', 'false')
              .load())
    query = (stream.writeStream.foreachBatch(write_batch)
             .option('checkpointLocation', CHECKPOINT)
             .trigger(processingTime=TRIGGER)
             .queryName('speed-layer')
             .start())
    while query.isActive and query.lastProgress is None:
        time.sleep(1)
    if query.isActive:
        READY.touch()
        print(f'speed layer listening on {ARCH["kafkaTopic"]}, writing to {OUTPUT}', flush=True)
    query.awaitTermination()


if __name__ == '__main__':
    main()
