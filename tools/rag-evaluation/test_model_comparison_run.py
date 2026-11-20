import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import rerank_model_comparison_run as runner


class ComparisonRunTests(unittest.TestCase):
    def test_foreign_inputs_or_model_fail_before_loading_weights(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "parent.json").write_text("{}")
            protocol = {"files_sha256": {}, "model_protocol": "parent.json",
                        "expected_pools": 1, "models": [], "runtime": {}, "model_input": {}}
            with patch.object(runner, "ROOT", root), patch.object(runner, "CrossEncoder") as factory:
                with patch.object(runner, "load_inputs", return_value=[]):
                    with self.assertRaisesRegex(ValueError, "pool count"):
                        runner.run(protocol, "missing", root, root)
                with patch.object(runner, "load_inputs", return_value=[{}]):
                    with self.assertRaisesRegex(ValueError, "unknown comparison model"):
                        runner.run(protocol, "missing", root, root)
                factory.assert_not_called()

    def test_metadata_mismatch_and_model_failure_never_create_complete_scores(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "parent.json").write_text("{}")
            protocol = {"files_sha256": {}, "model_protocol": "parent.json", "expected_pools": 1,
                        "models": [{"id": "fake"}], "runtime": {}, "model_input": {}}
            with patch.object(runner, "ROOT", root), patch.object(runner, "load_inputs", return_value=[{}]), patch.object(runner, "CrossEncoder") as factory:
                (root / "fake-metadata.json").write_text("{}")
                with self.assertRaisesRegex(ValueError, "metadata differs"):
                    runner.run(protocol, "fake", root, root)
                factory.assert_not_called()
                (root / "fake-metadata.json").unlink()
                with patch.object(runner, "run_tasks", side_effect=RuntimeError("failed")):
                    with self.assertRaisesRegex(RuntimeError, "failed"):
                        runner.run(protocol, "fake", root, root)
                self.assertFalse((root / "fake-scores.json").exists())


if __name__ == "__main__":
    unittest.main()
