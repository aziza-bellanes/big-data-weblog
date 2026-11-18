"""Full NASA baseline regression. Run after full ingestion, Hive analysis and Sqoop export."""
import json
import os
import time
from pathlib import Path
import pymysql

checks = [
    ('canonical_requests', 'SELECT total_lines FROM data_quality', 3461613),
    ('malformed', 'SELECT malformed_lines FROM data_quality', 33),
    ('top_resource', 'SELECT path FROM top_pages ORDER BY hits DESC LIMIT 1', '/images/NASA-logosmall.gif'),
    ('top_resource_hits', 'SELECT hits FROM top_pages ORDER BY hits DESC LIMIT 1', 208798),
    ('404', 'SELECT hits FROM status_distribution WHERE status=404', 20871),
    ('500', 'SELECT hits FROM status_distribution WHERE status=500', 65),
    ('top_host', 'SELECT host FROM top_hosts ORDER BY hits DESC LIMIT 1', 'piweba3y.prodigy.com'),
    ('top_host_hits', 'SELECT hits FROM top_hosts ORDER BY hits DESC LIMIT 1', 21987),
    ('peak_hour', 'SELECT hour_of_day FROM hits_per_hour ORDER BY avg_hits_per_day DESC LIMIT 1', 15),
]
report = {'observed_at': time.time(), 'source': 'MySQL reporting tables after Hive/Sqoop export', 'checks': []}
with pymysql.connect(host=os.environ.get('MYSQL_HOST', 'mysql'),
                     user=os.environ.get('SQOOP_DB_USER', 'sqoop'),
                     password=os.environ.get('SQOOP_DB_PASSWORD', 'sqoop'),
                     database=os.environ.get('WEBLOGS_DB', 'weblogs')) as connection:
    with connection.cursor() as cursor:
        for name, query, expected in checks:
            cursor.execute(query)
            row = cursor.fetchone()
            actual = row[0] if row else None
            report['checks'].append(dict(name=name, expected=expected, actual=actual, passed=actual == expected))
report['status'] = 'pass' if all(c['passed'] for c in report['checks']) else 'fail'
output = Path(os.environ.get('ARTIFACT_DIR', '/opt/artifacts')) / 'regression'
output.mkdir(parents=True, exist_ok=True)
(output / (time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()) + '.json')).write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
raise SystemExit(report['status'] != 'pass')
