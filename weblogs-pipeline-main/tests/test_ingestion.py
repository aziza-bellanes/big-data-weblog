import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, Mock
import types

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from events import event, records, source_files
from kafka_ingestion import publish, persist_and_commit
from replay import Config, replay

RAW = 'host - - [01/Jul/1995:23:59:59 -0400] "GET /images/a.gif HTTP/1.0" 404 -'


class ContractTests(unittest.TestCase):
    def test_historical_server_date_and_offset(self):
        result = event('Jul95', 1, RAW)
        self.assertEqual(result['dt'], '1995-07-01')
        self.assertEqual(result['event_time'], '1995-07-01T23:59:59-04:00')
        self.assertEqual((result['http_status'], result['bytes']), (404, 0))

    def test_repeated_requests_are_distinct_but_replay_identity_is_stable(self):
        self.assertNotEqual(event('Jul95', 1, RAW)['event_id'], event('Jul95', 2, RAW)['event_id'])
        self.assertEqual(event('Jul95', 1, RAW)['event_id'], event('Jul95', 1, RAW)['event_id'])

    def test_bad_record_is_preserved(self):
        result = event('Jul95', 2, 'malformed')
        self.assertEqual(result['raw_line'], 'malformed')
        self.assertEqual(result['dt'], 'unknown')
        self.assertIsNotNone(result['parse_error'])

    def test_fixture_counts(self):
        fixture = Path(__file__).parent / 'fixtures'
        values = list(records(source_files(fixture)))
        self.assertEqual(len(values), 100)
        self.assertEqual(sum(bool(row['parse_error']) for row in values), 2)
        self.assertEqual(len({row['event_id'] for row in values}), 100)
        self.assertEqual({r['dt'] for r in values}, {'1995-07-01', '1995-08-01', 'unknown'})

    def test_replay_resume_does_not_append_after_limit(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'access.log'
            cfg = Config(source_files(Path(__file__).parent / 'fixtures'), output, 100000, 40,
                         Path(directory) / 'offset')
            replay(cfg)
            replay(cfg)
            self.assertEqual(len(output.read_bytes().splitlines()), 40)


class Message:
    def value(self):
        return json.dumps(event('Jul95', 1, RAW)).encode()


class WriterTests(unittest.TestCase):
    def test_offsets_advance_only_after_successful_publication(self):
        fake = types.SimpleNamespace(TopicPartition=lambda *args: args)
        message = Mock()
        message.topic.return_value = 'web-logs'
        message.partition.return_value = 1
        message.offset.return_value = 7
        calls = []
        consumer = Mock()
        consumer.commit.side_effect = lambda **kwargs: calls.append(('commit', kwargs))
        with patch.dict(sys.modules, {'confluent_kafka': fake}), patch('kafka_ingestion.publish', side_effect=lambda _: calls.append(('publish', None))):
            persist_and_commit(consumer, [message])
        self.assertEqual([c[0] for c in calls], ['publish', 'commit'])
        self.assertEqual(calls[1][1], {'offsets': [('web-logs', 1, 8)], 'asynchronous': False})

    def test_crash_during_publication_never_commits_offsets(self):
        fake = types.SimpleNamespace(TopicPartition=lambda *args: args)
        consumer = Mock()
        with patch.dict(sys.modules, {'confluent_kafka': fake}), patch('kafka_ingestion.publish', side_effect=RuntimeError('crash')):
            with self.assertRaises(RuntimeError):
                persist_and_commit(consumer, [Message()])
        consumer.commit.assert_not_called()

    def test_publish_renames_only_after_closed_upload(self):
        calls = []
        with patch('kafka_ingestion.hdfs', side_effect=lambda *args: calls.append(args)):
            publish([Message(), Message()])
        self.assertEqual([c[0] for c in calls], ['-mkdir', '-put', '-mv'])
        self.assertIn('/dt=1995-07-01/', calls[-1][-1])
        self.assertIn('_inprogress', calls[1][-1])

    def test_failed_upload_never_publishes(self):
        calls = []
        def hdfs(*args):
            calls.append(args[0])
            if args[0] == '-put':
                raise RuntimeError('simulated HDFS outage')
        with patch('kafka_ingestion.hdfs', side_effect=hdfs):
            with self.assertRaises(RuntimeError):
                publish([Message()])
        self.assertNotIn('-mv', calls)


class RecoveryTests(unittest.TestCase):
    def test_full_replay_is_rejected_before_starting_a_producer(self):
        import experiment
        with patch('experiment.sample', return_value={'produced': 3461613}), \
                patch('experiment.get', return_value={'datasetLines': 3461613}), \
                patch('experiment.post') as post:
            with self.assertRaisesRegex(SystemExit, 'unread source events'):
                experiment.start()
        post.assert_not_called()


if __name__ == '__main__':
    unittest.main()
