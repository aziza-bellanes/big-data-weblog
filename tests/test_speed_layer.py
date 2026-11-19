import sys
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import spark_speed_layer
import verify_ingestion

Minute = types.SimpleNamespace


def minute(name, hits, not_found=0, server=0):
    return Minute(minute=name, dt=name[:10], hits=hits, client_errors=not_found,
                  not_found=not_found, server_errors=server, bytes=100 * hits)


class FakeMySQL:
    """Records the statements of one connection; batch_id lookups answer `applied`."""

    def __init__(self, applied=False):
        self.applied = applied
        self.statements = []
        self.committed = self.rolled_back = False
        cursor = MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.execute.side_effect = lambda sql, args=None: self.statements.append((sql, args))
        cursor.executemany.side_effect = lambda sql, rows: self.statements.append((sql, list(rows)))
        cursor.fetchone.side_effect = lambda: (1,) if self.applied else None
        self.connection = MagicMock()
        self.connection.cursor.return_value = cursor
        self.connection.commit.side_effect = lambda: setattr(self, 'committed', True)
        self.connection.rollback.side_effect = lambda: setattr(self, 'rolled_back', True)

    def sql(self, needle):
        return [s for s in self.statements if needle in s[0]]


class ServeTests(unittest.TestCase):
    def serve(self, fake, minutes, hosts=()):
        pymysql = types.SimpleNamespace(connect=lambda **_: fake.connection)
        with patch.dict(sys.modules, {'pymysql': pymysql}):
            return spark_speed_layer.serve(7, 120, minutes, list(hosts))

    def test_new_batch_is_applied_in_one_transaction(self):
        fake = FakeMySQL()
        minutes = [minute('1995-07-13 10:42', 310, not_found=16), minute('1995-07-13 10:41', 20)]
        hosts = [Minute(minute='1995-07-13 10:42', host='a.example', hits=31)]
        self.assertTrue(self.serve(fake, minutes, hosts))
        self.assertTrue(fake.committed)
        self.assertEqual(len(fake.sql('INSERT INTO speed_minute')[0][1]), 2)
        self.assertEqual(fake.sql('INSERT INTO speed_host_minute')[0][1], [('1995-07-13 10:42', 'a.example', 31)])
        # every alert kind is refreshed for the touched minutes only, in time order
        alerts = fake.sql('INSERT INTO speed_alerts')
        self.assertEqual(len(alerts), len(spark_speed_layer.MINUTE_ALERTS) + 1)
        for _, args in alerts:
            self.assertIn('1995-07-13 10:41', args)
            self.assertIn('1995-07-13 10:42', args)
        (_, batch), = fake.sql('INSERT INTO speed_batches')
        self.assertEqual(batch, (7, 120, 330, '1995-07-13 10:41', '1995-07-13 10:42'))
        # the batch row is written last, in the same transaction as the totals
        self.assertIn('INSERT INTO speed_batches', fake.statements[-1][0])

    def test_replayed_batch_is_skipped(self):
        fake = FakeMySQL(applied=True)
        self.assertFalse(self.serve(fake, [minute('1995-07-13 10:42', 5)]))
        self.assertTrue(fake.rolled_back)
        self.assertFalse(fake.committed)
        self.assertEqual(fake.sql('INSERT'), [])

    def test_empty_batch_still_records_its_id(self):
        fake = FakeMySQL()
        self.assertTrue(self.serve(fake, []))
        self.assertEqual(fake.sql('INSERT INTO speed_alerts'), [])
        (_, batch), = fake.sql('INSERT INTO speed_batches')
        self.assertEqual(batch, (7, 120, 0, None, None))

    def test_failure_rolls_back(self):
        fake = FakeMySQL()
        fake.connection.cursor.return_value.executemany.side_effect = RuntimeError('lost')
        with self.assertRaises(RuntimeError):
            self.serve(fake, [minute('1995-07-13 10:42', 5)])
        self.assertTrue(fake.rolled_back)
        self.assertFalse(fake.committed)


class SparkOffsetsTests(unittest.TestCase):
    def run_hdfs(self, listing, offsets):
        def fake(args, **_):
            out = listing if args[2] == '-ls' else offsets
            return types.SimpleNamespace(stdout=out)
        return patch.object(verify_ingestion.subprocess, 'run', side_effect=fake)

    def test_offsets_of_the_last_committed_batch(self):
        listing = ('Found 3 items\n'
                   '-rw-r--r--   1 hadoop supergroup 29 2026-11-18 10:00 /ckpt/commits/9\n'
                   '-rw-r--r--   1 hadoop supergroup 29 2026-11-18 10:00 /ckpt/commits/10\n'
                   '-rw-r--r--   1 hadoop supergroup 29 2026-11-18 10:00 /ckpt/commits/.10.crc\n')
        offsets = 'v1\n{"batchWatermarkMs":0}\n{"web-events":{"0":5,"1":7,"2":9}}\n'
        with self.run_hdfs(listing, offsets) as run:
            self.assertEqual(verify_ingestion.spark_offsets('/ckpt', 'web-events'), {0: 5, 1: 7, 2: 9})
        self.assertEqual(run.call_args_list[-1].args[0][-1], '/ckpt/offsets/10')

    def test_no_committed_batch_is_an_error(self):
        with self.run_hdfs('', ''), self.assertRaises(ValueError):
            verify_ingestion.spark_offsets('/ckpt', 'web-events')


if __name__ == '__main__':
    unittest.main()
