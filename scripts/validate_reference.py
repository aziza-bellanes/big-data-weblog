"""Compare a staged Sqoop snapshot with the relational source before publication."""
import os
import subprocess
import sys
from collections import Counter

import pymysql

with pymysql.connect(host=os.environ.get('MYSQL_HOST', 'mysql'),
                     user=os.environ.get('SQOOP_DB_USER', 'sqoop'),
                     password=os.environ.get('SQOOP_DB_PASSWORD', 'sqoop'),
                     database=os.environ.get('WEBLOGS_DB', 'weblogs')) as connection:
    with connection.cursor() as cursor:
        cursor.execute('SELECT code,label,category FROM status_codes')
        expected = Counter('\t'.join(map(str, row)) for row in cursor.fetchall())
actual = Counter(subprocess.run(['hdfs', 'dfs', '-cat', sys.argv[1] + '/part-*'],
                                check=True, capture_output=True, text=True).stdout.splitlines())
if not expected or expected != actual:
    raise SystemExit('FAIL: staged Sqoop reference differs from MySQL')
print(f'PASS: {sum(actual.values())} validated reference rows')
