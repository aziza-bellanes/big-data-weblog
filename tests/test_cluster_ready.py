"""Readiness must fail before a reset or a web job can change run state."""
import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import cluster_ready
import control_server
import reset_architecture


def namenode(safe=""):
    return {"beans": [{"Safemode": safe, "LiveNodes": json.dumps({"hadoop:9866": {}}),
                       "NumberOfMissingBlocks": 0, "Free": 10 * 1024**3}]}


class ReadinessTests(unittest.TestCase):
    def test_safe_mode_blocks_writes_even_with_a_live_datanode(self):
        with patch.object(cluster_ready, "read_json", return_value=namenode("Resources are low")):
            with self.assertRaisesRegex(cluster_ready.ClusterNotReady, "safe mode"):
                cluster_ready.require_ready(require_yarn=False)

    def test_unhealthy_worker_blocks_jobs_even_when_hdfs_is_writable(self):
        nodes = {"nodes": {"node": [{"state": "UNHEALTHY", "healthReport": "disk is full"}]}}
        with patch.object(cluster_ready, "read_json", side_effect=[namenode(), nodes]):
            state = cluster_ready.check()
        self.assertFalse(state["ready"])
        self.assertIn("disk is full", state["problems"][0])

    def test_writable_hdfs_and_running_worker_are_ready(self):
        nodes = {"nodes": {"node": [{"state": "RUNNING"}]}}
        with patch.object(cluster_ready, "read_json", side_effect=[namenode(), nodes]):
            self.assertTrue(cluster_ready.check()["ready"])

    def test_disk_headroom_allows_smoke_run_but_refuses_full_run(self):
        state = {"freeBytes": 5 * 1024**3}
        cluster_ready.require_space(state, 200000, 1100)
        with self.assertRaisesRegex(cluster_ready.ClusterNotReady, "choose a smaller dataset"):
            cluster_ready.require_space(state, 3461613, 1100)

    def test_unreachable_hdfs_is_not_ready(self):
        with patch.object(cluster_ready, "read_json", side_effect=OSError("connection refused")):
            state = cluster_ready.check(require_yarn=False)
        self.assertFalse(state["ready"])
        self.assertIn("connection refused", state["problems"][0])

    def test_failed_preflight_preserves_live_log_and_replay_checkpoints(self):
        with tempfile.TemporaryDirectory() as directory:
            paths = [Path(directory) / name for name in ("access.log", "access.log.offset", "producer.offset")]
            for path in paths:
                path.write_text("previous run")
            with patch.object(reset_architecture.architectures, "get", return_value={"liveDir": directory}), \
                    patch.object(reset_architecture, "require_ready", side_effect=cluster_ready.ClusterNotReady("safe mode")), \
                    patch.object(reset_architecture, "clear_hdfs") as hdfs, \
                    patch.object(reset_architecture, "clear_mysql") as mysql:
                self.assertEqual(reset_architecture.main(["reset", "parallel"]), 1)
            self.assertTrue(all(path.read_text() == "previous run" for path in paths))
            hdfs.assert_not_called()
            mysql.assert_not_called()

    def test_failed_hdfs_reset_preserves_checkpoints_even_after_preflight(self):
        with tempfile.TemporaryDirectory() as directory:
            checkpoint = Path(directory) / "access.log.offset"
            checkpoint.write_text("200000")
            arch = {"label": "B", "liveDir": directory}
            with patch.object(reset_architecture.architectures, "get", return_value=arch), \
                    patch.object(reset_architecture, "require_ready"), \
                    patch.object(reset_architecture, "clear_hdfs", side_effect=subprocess.CalledProcessError(1, "hdfs")), \
                    patch.object(reset_architecture, "clear_mysql") as mysql:
                with self.assertRaises(subprocess.CalledProcessError):
                    reset_architecture.main(["reset", "parallel"])
            self.assertEqual(checkpoint.read_text(), "200000")
            mysql.assert_not_called()

    def test_web_start_returns_readiness_error_without_starting_a_job(self):
        handler = object.__new__(control_server.Handler)
        body = json.dumps({"action": "replay", "arch": "parallel"}).encode()
        handler.headers = {"Content-Length": str(len(body))}
        handler.rfile = io.BytesIO(body)
        handler._json = Mock()
        with patch.object(cluster_ready, "require_ready", side_effect=cluster_ready.ClusterNotReady("HDFS is in safe mode")), \
                patch.object(control_server.RUNNER, "start") as start:
            handler._start()
        start.assert_not_called()
        handler._json.assert_called_once_with(503, {"error": "HDFS is in safe mode"})

    def test_full_web_replay_is_refused_before_start_when_disk_is_too_small(self):
        handler = object.__new__(control_server.Handler)
        body = json.dumps({"action": "replay", "arch": "parallel", "limit": 0, "rate": 5000}).encode()
        handler.headers = {"Content-Length": str(len(body))}
        handler.rfile = io.BytesIO(body)
        handler._json = Mock()
        with patch.object(cluster_ready, "require_ready", return_value={"freeBytes": 5 * 1024**3}), \
                patch.object(control_server.DATASET, "total_lines", 3461613), \
                patch.object(control_server.RUNNER, "start") as start:
            handler._start()
        start.assert_not_called()
        status, payload = handler._json.call_args.args
        self.assertEqual(status, 503)
        self.assertIn("choose a smaller dataset", payload["error"])


if __name__ == "__main__":
    unittest.main()
