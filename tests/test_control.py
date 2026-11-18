import sys
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from control_server import Runner, Step, Conflict


class ControlIsolationTests(unittest.TestCase):
    def test_independent_jobs_overlap_and_conflicting_rerun_is_rejected(self):
        runner = Runner()
        release = threading.Event()
        def hold(job, state):
            state.status = 'running'
            release.wait(2)
            state.status = 'succeeded'
        with patch.object(runner, '_run_step', side_effect=hold), patch('control_server.replay_running', return_value=False):
            flume = runner.start('ingest-flume', [Step('test', 'test', [])])
            kafka = runner.start('ingest-kafka', [Step('test', 'test', [])])
            try:
                self.assertEqual(len(runner.active), 2)
                with self.assertRaises(Conflict):
                    runner.start('ingest-flume', [])
                with self.assertRaises(Conflict):
                    runner.start('pipeline', [])
                self.assertNotEqual(flume.id, kafka.id)
            finally:
                release.set()
            deadline = time.monotonic() + 2
            while runner.active and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertFalse(runner.active)

    def test_spawn_failure_is_terminal_and_releases_resource(self):
        runner = Runner()
        with patch('control_server.replay_running', return_value=False), patch.object(runner, '_run_step', side_effect=OSError('missing executable')):
            job = runner.start('ingest-kafka', [Step('test', 'test', [])])
            deadline = time.monotonic() + 2
            while job.status == 'running' and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertEqual(job.status, 'failed')
            self.assertEqual(job.steps[0].status, 'failed')
