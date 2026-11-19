import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import rerank_refinement_run as runner


class CheckpointTests(unittest.TestCase):
    def fixture(self, root):
        pool = [{"chunkId": "c", "title": "标题", "content": "正文"}]
        (root / "replay.json").write_text(json.dumps({"sources": [{"id": "s", "rows": [{"id": q, "pool": pool} for q in ["q1", "q2"]]}]}))
        (root / "model.json").write_text(json.dumps({"runtime": {}, "models": [{"id": "bge-m3"}], "model_input": {}, "queries": {"s": {"q1": "first", "q2": "second"}}}))
        return {"files_sha256": {}, "model_protocol": "model.json", "replay": "replay.json",
                "input_cases": [{"source": "s", "id": q} for q in ["q1", "q2"]],
                "input_variants": [{"id": "body", "mode": "body"}, {"id": "sections", "mode": "sections"}]}

    def test_failed_later_variant_keeps_only_complete_cases_and_resume_skips_them(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            protocol = self.fixture(root)
            output = root / "scores.json"
            result = {"scores": [1], "diagnostics": [{"windows": 1}], "elapsed_ms": 1}

            def fail_later(model, query, pool, variant):
                if query == "second" and variant["id"] == "sections":
                    raise RuntimeError("model unavailable")
                return copy.deepcopy(result)

            with patch.object(runner, "ROOT", root), patch.object(runner, "CrossEncoder"), patch.object(runner, "score", side_effect=fail_later):
                with self.assertRaisesRegex(RuntimeError, "unavailable"):
                    runner.run(protocol, "input", output, root)
            self.assertFalse(output.exists())
            checkpoint = output.with_suffix(".jsonl")
            records = [json.loads(line) for line in checkpoint.read_text().splitlines()]
            self.assertEqual([r["id"] for r in records], ["q1"])
            with patch.object(runner, "ROOT", root), patch.object(runner, "CrossEncoder"), patch.object(runner, "score", return_value=result) as score:
                runner.run(protocol, "input", output, root)
                self.assertNotIn("first", [call.args[1] for call in score.call_args_list])
            saved = json.loads(output.read_text())
            self.assertTrue(saved["complete"])
            self.assertEqual([r["id"] for r in saved["rows"]], ["q1", "q2"])
            before = output.read_bytes()
            changed = copy.deepcopy(protocol)
            changed["input_variants"][0]["mode"] = "different"
            with patch.object(runner, "ROOT", root), patch.object(runner, "CrossEncoder") as factory:
                with self.assertRaisesRegex(ValueError, "protocol differs"):
                    runner.run(changed, "input", output, root)
                factory.assert_not_called()
            self.assertEqual(output.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
