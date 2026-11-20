import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, MagicMock

import rerank_verifier_run as runner


class VerifierRunTests(unittest.TestCase):
    def fixture(self):
        protocol = {"files_sha256": {}, "model": {"name": "model", "digest": "digest"},
                    "options": {}, "timeout_seconds": 1}
        task = {"source": "s", "id": "q", "query": "q", "input_sha256": "input",
                "candidates": [{"id": "P0"}]}
        response = MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps(
            {"models": [{"name": "model", "digest": "digest"}]}).encode()
        return protocol, task, response

    def test_failure_does_not_write_complete_result_and_resume_rejects_foreign_identity(self):
        protocol, task, response = self.fixture()
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            with patch.object(runner, "prepare", return_value=[task]), patch.object(runner.urllib.request, "urlopen", return_value=response), patch.object(runner, "verify", side_effect=RuntimeError("failed")):
                with self.assertRaises(RuntimeError):
                    runner.run(protocol, output, "http://local")
                self.assertFalse((output / "verdicts.json").exists())
            row = {"source": "s", "id": "q", "input_sha256": "foreign", "answerable": True, "selected": ["P0"]}
            (output / "checkpoint.jsonl").write_text(json.dumps(row) + "\n")
            with patch.object(runner, "prepare", return_value=[task]), patch.object(runner.urllib.request, "urlopen", return_value=response):
                with self.assertRaisesRegex(ValueError, "identity differs"):
                    runner.run(protocol, output, "http://local")

    def test_complete_results_preserve_input_identity(self):
        protocol, task, response = self.fixture()
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            with patch.object(runner, "prepare", return_value=[task]), patch.object(runner.urllib.request, "urlopen", return_value=response), patch.object(runner, "verify", return_value={"answerable": True, "selected": ["P0"]}):
                runner.run(protocol, output, "http://local")
            result = json.loads((output / "verdicts.json").read_text())
            self.assertTrue(result["complete"])
            self.assertEqual(result["rows"][0]["input_sha256"], "input")


if __name__ == "__main__":
    unittest.main()
