import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from rerank_model_input import fingerprint
import rerank_verifier_audit as verifier


class VerifierAuditTests(unittest.TestCase):
    def test_negative_only_pilot_group_has_null_evidence_metric(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "questions.json").write_text(json.dumps([
                {"id": "q", "question": "unanswerable", "split": "regression", "type": "unanswerable", "evidence": [], "gold_docs": []}
            ]))
            option = {"selected": [], "characters": 0, "decisions": []}
            source = {"id": "s", "dataset": ".", "metadata": {"document_mapping": []},
                      "rows": [{"id": "q", "pool": [], "options": {"current": option, "verified": option}}]}
            with patch.object(verifier, "ROOT", root):
                result = verifier.grade_pilot({"sources": [source]})
            self.assertIsNone(result["overall"]["verified"]["evidence_recall"])
            self.assertEqual(result["overall"]["verified"]["negative_empty_rate"], 1)

    def test_alias_mapping_preserves_body_and_applies_utf16_constraints(self):
        protocol = {"replay": "replay.json", "constraints": {"maxChunksPerDocument": 1, "maxContextCharacters": 2}}
        pool = [{"chunkId": "a", "documentId": "doc", "content": "😀"},
                {"chunkId": "b", "documentId": "doc", "content": "b"},
                {"chunkId": "c", "documentId": "other", "content": "c"}]
        task = {"source": "s", "id": "q", "input_sha256": "input", "pool": pool,
                "candidates": [{"id": f"P{i}"} for i in range(3)]}
        result = {"complete": True, "protocol_sha256": fingerprint(protocol), "rows": [
            {"source": "s", "id": "q", "input_sha256": "input", "answerable": True, "selected": ["P0", "P1", "P2"]}]}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            original = {"sources": [{"id": "s", "rows": [{"id": "q", "pool": pool, "options": {"rule": {}, "short": {}}}]}]}
            (root / "replay.json").write_text(json.dumps(original))
            with patch.object(verifier, "ROOT", root), patch.object(verifier, "prepare", return_value=[task]):
                replay = verifier.replay_verdicts(protocol, result)
                option = replay["sources"][0]["rows"][0]["options"]["verified"]
                self.assertEqual(option["selected"], ["a"])
                self.assertEqual(option["characters"], 2)
                self.assertEqual([d["reason"] for d in option["decisions"]], ["selected", "document_cap", "character_budget"])
                self.assertEqual(replay["sources"][0]["rows"][0]["pool"], pool)
                result["rows"][0]["input_sha256"] = "foreign"
                with self.assertRaisesRegex(ValueError, "identity differs"):
                    verifier.replay_verdicts(protocol, result)


if __name__ == "__main__":
    unittest.main()
