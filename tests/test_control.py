import contextlib
import io
import json
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import architectures
import runs
from control_server import (BadRequest, Conflict, Job, Runner, Step, StepState,
                            plan, resources)

SEQ, PAR = 'sequential', 'parallel'


def one_step(key='test', arch=None):
    return [Step(key, key, [], arch)]


class RunnerTests(unittest.TestCase):
    """Jobs run with a blocking fake step body; nothing is executed."""

    def setUp(self):
        self.runner = Runner()
        self.release = threading.Event()

        def hold(job, state):
            state.status = 'running'
            self.release.wait(2)
            state.status = 'succeeded'

        for patcher in (patch.object(self.runner, '_run_step', side_effect=hold),
                        patch('control_server.runs.save'),
                        patch('control_server.replay_running', return_value=False)):
            patcher.start()
            self.addCleanup(patcher.stop)
        # Finish the worker threads before restoring persistence and real steps.
        self.addCleanup(self.drain)

    def drain(self):
        self.release.set()
        deadline = time.monotonic() + 2
        while self.runner.active and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertFalse(self.runner.active)

    def start(self, action, arch):
        return self.runner.start(action, arch, one_step(action, arch))

    def test_jobs_of_different_architectures_overlap(self):
        a = self.start('replay', SEQ)
        b = self.start('replay', PAR)
        self.assertEqual(len(self.runner.active), 2)
        self.assertNotEqual(a.id, b.id)

    def test_same_architecture_conflicts_are_rejected(self):
        self.start('replay', PAR)
        with self.assertRaises(Conflict):
            self.start('ingest-flume', PAR)
        with self.assertRaises(Conflict):
            self.start('replay', PAR)

    def test_sequential_pipeline_cannot_run_twice(self):
        self.start('pipeline', SEQ)
        with self.assertRaises(Conflict):
            self.start('pipeline', SEQ)
        self.start('pipeline', PAR)  # the other architecture is free

    def test_sequential_replay_and_pipeline_do_not_conflict(self):
        self.start('replay', SEQ)
        self.start('pipeline', SEQ)
        self.assertEqual(len(self.runner.active), 2)

    def test_compare_conflicts_with_anything_running(self):
        self.start('pipeline', PAR)
        with self.assertRaises(Conflict):
            self.runner.start('compare', None, one_step('compare'))

    def test_anything_conflicts_with_a_running_compare(self):
        self.runner.start('compare', None, one_step('compare'))
        for action, arch in (('replay', SEQ), ('pipeline', PAR), ('ingest-kafka', PAR)):
            with self.assertRaises(Conflict):
                self.start(action, arch)

    def test_parallel_branches_overlap_each_other(self):
        jobs = [self.start(action, PAR) for action in ('ingest-flume', 'ingest-kafka', 'ingest-sqoop')]
        self.assertEqual(len(self.runner.active), 3)
        self.assertEqual(len({j.id for j in jobs}), 3)
        with self.assertRaises(Conflict):
            self.start('ingest-kafka', PAR)

    def test_replay_started_outside_the_dashboard_is_a_conflict(self):
        with patch('control_server.replay_running', side_effect=lambda arch: arch == SEQ):
            with self.assertRaises(Conflict):
                self.start('replay', SEQ)
            self.start('replay', PAR)

    def test_finished_job_moves_to_history_and_frees_resources(self):
        job = self.start('pipeline', SEQ)
        self.release.set()
        deadline = time.monotonic() + 2
        while job.status == 'running' and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertEqual(job.status, 'succeeded')
        deadline = time.monotonic() + 2
        while self.runner.active and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertIs(self.runner.find(job.id), job)


class SpawnFailureTests(unittest.TestCase):
    def test_spawn_failure_is_terminal_and_releases_resource(self):
        runner = Runner()
        with patch('control_server.replay_running', return_value=False), \
                patch.object(runner, '_run_step', side_effect=OSError('missing executable')):
            job = runner.start('ingest-kafka', PAR, one_step('test', PAR))
            deadline = time.monotonic() + 2
            while job.status == 'running' and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertEqual(job.status, 'failed')
            self.assertEqual(job.steps[0].status, 'failed')
            deadline = time.monotonic() + 2
            while runner.active and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertFalse(runner.active)
            again = runner.start('ingest-kafka', PAR, one_step('test', PAR))  # resource is free again
            self.assertNotEqual(again.id, job.id)


class PlanTests(unittest.TestCase):
    def keys(self, body):
        return [(s.key, s.arch) for s in plan(body)[2]]

    def test_compare_with_fresh_default_runs_reset_then_both_architectures(self):
        action, arch, steps, params = plan({'action': 'compare'})
        self.assertEqual((action, arch), ('compare', None))
        self.assertEqual(params, {'rate': 5000, 'limit': 0, 'fresh': True})
        pairs = [(s.key, s.arch) for s in steps]
        # the two resets come first, in any architecture order
        self.assertEqual(sorted(pairs[:2]), [('reset', PAR), ('reset', SEQ)])
        expected = [(k, SEQ) for k in ('replay', 'counts', 'hive-tables', 'sqoop-import',
                                       'hive-analysis', 'sqoop-export', 'fingerprint')]
        expected += [(k, PAR) for k in ('replay', 'counts', 'hive-tables', 'verify-ingestion',
                                        'hive-analysis', 'sqoop-export', 'fingerprint')]
        expected.append(('compare', None))
        self.assertEqual(pairs[2:], expected)

    def test_compare_without_fresh_has_no_reset(self):
        pairs = self.keys({'action': 'compare', 'fresh': False})
        self.assertNotIn('reset', [k for k, _ in pairs])
        self.assertEqual(pairs[0], ('replay', SEQ))
        self.assertEqual(pairs[-1], ('compare', None))

    def test_pipelines_differ_between_architectures(self):
        sequential = [k for k, _ in self.keys({'action': 'pipeline', 'arch': SEQ})]
        parallel = [k for k, _ in self.keys({'action': 'pipeline', 'arch': PAR})]
        self.assertIn('sqoop-import', sequential)
        self.assertNotIn('sqoop-import', parallel)
        self.assertIn('verify-ingestion', parallel)

    def test_replay_step_environment(self):
        _, arch, steps, params = plan({'action': 'replay', 'arch': SEQ, 'rate': 1000, 'limit': 50})
        env = dict(steps[0].env)
        self.assertEqual(arch, SEQ)
        self.assertEqual(env['ARCH'], SEQ)
        self.assertEqual(env['REPLAY_RATE'], '1000')
        self.assertEqual(env['REPLAY_LIMIT'], '50')
        self.assertEqual(params, {'rate': 1000, 'limit': 50})

    def test_missing_arch_uses_the_default(self):
        self.assertEqual(architectures.DEFAULT, 'parallel')
        self.assertEqual(plan({'action': 'replay'})[1], architectures.DEFAULT)
        self.assertEqual(plan({'action': 'counts'})[1], architectures.DEFAULT)

    def test_parallel_branch_is_accepted(self):
        action, arch, steps, _ = plan({'action': 'ingest-kafka', 'arch': PAR})
        self.assertEqual((action, arch, steps[0].arch), ('ingest-kafka', PAR, PAR))

    def test_bad_requests(self):
        bad = [
            {'action': 'replay', 'rate': 123},
            {'action': 'replay', 'limit': -1},
            {'action': 'replay', 'limit': True},
            {'action': 'replay', 'limit': 1.5},
            {'action': 'compare', 'rate': 7},
            {'action': 'replay', 'arch': 'nope'},
            {'action': 'frobnicate'},
            {},
            {'action': 'ingest-kafka', 'arch': SEQ},
            {'action': 'ingest-flume', 'arch': SEQ},
            {'action': 'verify-ingestion', 'arch': SEQ},
        ]
        for body in bad:
            with self.subTest(body=body), self.assertRaises(BadRequest):
                plan(body)


class ResourcesTests(unittest.TestCase):
    def test_examples(self):
        self.assertEqual(resources('replay', SEQ), {'seq-ingest'})
        self.assertEqual(resources('pipeline', SEQ), {'seq-batch'})
        self.assertEqual(resources('reset', SEQ), {'seq-ingest', 'seq-batch'})
        self.assertEqual(resources('ingest-kafka', PAR), {'par-kafka'})
        self.assertEqual(resources('sqoop-import', PAR), {'par-sqoop'})
        self.assertEqual(resources('pipeline', PAR), {'par-batch'})
        self.assertEqual(resources('replay', PAR), {'par-flume', 'par-kafka', 'par-sqoop'})
        self.assertEqual(resources('compare', None), resources('reset', SEQ) | resources('reset', PAR))

    def test_architectures_never_share_a_resource(self):
        actions = ('replay', 'reset', 'pipeline', 'counts', 'hive-tables', 'sqoop-import',
                   'hive-analysis', 'sqoop-export')
        for a in actions:
            for b in actions:
                with self.subTest(sequential=a, parallel=b):
                    self.assertFalse(resources(a, SEQ) & resources(b, PAR))


class JobRecordTests(unittest.TestCase):
    @staticmethod
    def state(key, arch, start, end):
        return StepState(Step(key, key, [], arch), 'succeeded', start, end, 0)

    def test_run_record(self):
        steps = [
            self.state('replay', PAR, 100.0, 110.0),
            self.state('hive-tables', PAR, 110.0, 112.5),
            self.state('verify-ingestion', PAR, 112.5, 115.0),
            self.state('hive-analysis', PAR, 115.0, 135.0),
            self.state('sqoop-export', PAR, 135.0, 140.0),
            self.state('counts', PAR, 140.0, 141.0),
            StepState(Step('fingerprint', 'x', arch=PAR)),  # never ran
        ]
        job = Job('pipeline', PAR, steps, {'rate': 5000})
        job.results[PAR] = {'ingestion': {'lines': 10}}
        record = job.record()
        self.assertEqual(record['kind'], 'run')
        self.assertEqual(record['arch'], PAR)
        self.assertEqual(list(record['architectures']), [PAR])
        entry = record['architectures'][PAR]
        self.assertEqual(entry['ingestion'], {'lines': 10})
        self.assertEqual(entry['steps']['replay'], 10.0)
        self.assertEqual(entry['steps']['hive-tables'], 2.5)
        self.assertEqual(entry['steps']['counts'], 1.0)
        self.assertNotIn('fingerprint', entry['steps'])
        # replay and counts are not batch work
        self.assertEqual(entry['batchSeconds'], 2.5 + 2.5 + 20.0 + 5.0)
        json.dumps(record)

    def test_batch_seconds_is_none_without_batch_steps(self):
        job = Job('replay', SEQ, [self.state('replay', SEQ, 0.0, 4.0)])
        self.assertIsNone(job.record()['architectures'][SEQ]['batchSeconds'])

    def test_compare_job_is_a_comparison(self):
        steps = [self.state('replay', SEQ, 0.0, 1.0), self.state('replay', PAR, 1.0, 2.0),
                 StepState(Step('compare', 'Compare'))]
        job = Job('compare', None, steps)
        job.results['comparison'] = {'allResultsMatch': True}
        record = job.record()
        self.assertEqual(record['kind'], 'comparison')
        self.assertEqual(set(record['architectures']), {SEQ, PAR})
        self.assertEqual(record['comparison'], {'allResultsMatch': True})


class RunsTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.dir = Path(directory.name) / 'runs'
        patcher = patch.object(runs, 'RUNS_DIR', self.dir)
        patcher.start()
        self.addCleanup(patcher.stop)

    @staticmethod
    def record(run_id='abc123'):
        return {'id': run_id, 'architectures': {
            'parallel': {'ingestion': {'lines': 3, 'samples': [{'t': 1}, {'t': 2}]}},
            'sequential': {'ingestion': {'lines': 3, 'samples': [{'t': 1}]}}}}

    def test_results_match(self):
        same = {t: {'rows': 1, 'sha256': 'x'} for t in runs.RESULT_TABLES}
        other = dict(same, top_pages={'rows': 2, 'sha256': 'y'})
        match = runs.results_match(same, other)
        self.assertEqual(set(match), set(runs.RESULT_TABLES))
        self.assertFalse(match['top_pages'])
        self.assertTrue(match['top_hosts'])
        self.assertFalse(any(runs.results_match({}, same).values()))

    def test_strip_samples_does_not_mutate(self):
        record = self.record()
        stripped = runs.strip_samples(record)
        for arch in stripped['architectures'].values():
            self.assertNotIn('samples', arch['ingestion'])
            self.assertEqual(arch['ingestion']['lines'], 3)
        self.assertIn('samples', record['architectures']['parallel']['ingestion'])
        runs.strip_samples({'id': 'x'})  # records without architectures are fine

    def test_save_load_round_trip(self):
        record = self.record()
        runs.save(record)
        self.assertEqual(runs.load('abc123'), record)  # load keeps the samples
        self.assertIsNone(runs.load('missing'))
        self.assertEqual([p.name for p in self.dir.iterdir()], ['abc123.json'])

    def test_load_rejects_path_like_ids(self):
        runs.save(self.record())
        for bad in ('../abc123', 'a/b', '..', '', 'a.b'):
            with self.subTest(id=bad):
                self.assertIsNone(runs.load(bad))

    def test_load_all_most_recent_first_without_samples(self):
        import os
        for index, run_id in enumerate(('one', 'two', 'three')):
            runs.save(self.record(run_id))
            os.utime(self.dir / f'{run_id}.json', (1000 + index, 1000 + index))
        (self.dir / 'broken.json').write_text('{not json')
        os.utime(self.dir / 'broken.json', (1, 1))
        loaded = runs.load_all()
        self.assertEqual([r['id'] for r in loaded], ['three', 'two', 'one'])
        self.assertNotIn('samples', loaded[0]['architectures']['parallel']['ingestion'])
        self.assertEqual(len(runs.load_all(limit=2)), 2)

    def test_load_all_without_directory(self):
        self.assertEqual(runs.load_all(), [])

    def test_settle_publishes_progress_until_files_close(self):
        with patch.object(runs, 'sink_drained', return_value=0), patch.object(runs, 'read_counter', return_value=0):
            ingestion = runs.Ingestion(SEQ)
        points = [dict(replayed=10, inHdfs=5, lag=5),
                  dict(replayed=10, inHdfs=10, lag=0),
                  dict(replayed=10, inHdfs=10, lag=0)]
        seen = []
        with patch.object(ingestion, 'sample', side_effect=points), \
                patch.object(runs, 'open_files', side_effect=[1, 0]), patch('runs.time.sleep'):
            self.assertTrue(ingestion.settle(30, lambda _: None, on_sample=seen.append))
        self.assertEqual(seen, points)
        self.assertIsNotNone(ingestion.written_at)
        self.assertIsNotNone(ingestion.closed_at)


class ArchitecturesTests(unittest.TestCase):
    def test_get(self):
        arch = architectures.get(SEQ)
        self.assertEqual(arch['liveLog'], arch['liveDir'] + '/access.log')
        self.assertEqual(arch['name'], SEQ)
        with self.assertRaises(ValueError):
            architectures.get('nope')

    def test_get_defaults_to_environment_then_default(self):
        with patch.dict('os.environ', {'ARCH': SEQ}):
            self.assertEqual(architectures.get()['name'], SEQ)
        with patch.dict('os.environ', {}, clear=True):
            self.assertEqual(architectures.get()['name'], architectures.DEFAULT)

    def test_env_output(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(architectures.main(['x', 'env', SEQ]), 0)
        lines = out.getvalue().splitlines()
        self.assertIn('export WEBLOGS_DB=weblogs', lines)
        self.assertIn('export HIVE_DB=weblogs', lines)

    def test_list_and_usage(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(architectures.main(['x', 'list']), 0)
        self.assertEqual(set(out.getvalue().split()), {SEQ, PAR})
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(architectures.main(['x']), 2)

    def test_architectures_share_no_storage(self):
        a, b = architectures.get(SEQ), architectures.get(PAR)
        for key in ('rawDir', 'eventsDir', 'referenceDir', 'resultsRoot', 'liveDir',
                    'hiveDb', 'mysqlDb', 'kafkaTopic'):
            with self.subTest(key=key):
                self.assertNotEqual(a[key], b[key])
        # no HDFS folder of one is inside a folder of the other
        folders = ('rawDir', 'eventsDir', 'referenceDir', 'resultsRoot')
        for x in (a[k] for k in folders if a[k]):
            for y in (b[k] for k in folders if b[k]):
                self.assertFalse(x == y or x.startswith(y + '/') or y.startswith(x + '/'), (x, y))


if __name__ == '__main__':
    unittest.main()
