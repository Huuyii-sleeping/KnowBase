import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import rerank_refinement_audit as audit
from rerank_model_input import fingerprint
from rerank_refinement_decision import decide


class AuditTests(unittest.TestCase):
    def setUp(self):
        self.pool = [{"chunkId": "a", "documentId": "d", "title": "T", "content": "关键依据"},
                     {"chunkId": "b", "documentId": "d", "title": "T", "content": "干扰文字"}]
        self.replay = {"sources": [{"id": "s", "dataset": "dataset", "metadata": {"document_mapping": [{"file": "d.md", "id": "d"}]},
                                    "rows": [{"id": "q", "pool": self.pool, "options": {
                                        "rule": {"selected": ["a"]}, "current": {"selected": ["a"]},
                                        "body": {"selected": ["b"]}}}]}]}
        self.protocol = {"performance_cases": [{"source": "s", "id": "q"}], "performance_repeats": 1,
                         "performance_variants": [{"id": "title"}], "constraints": {"topK": 5}}
        self.scores = {"complete": True, "group": "performance", "protocol_sha256": fingerprint(self.protocol), "rows": [
            {"source": "s", "id": "q", "repeat": 0, "chunk_ids": ["a", "b"], "variants": {
                "title": {"scores": [1, 0], "elapsed_ms": 10, "diagnostics": [{"windows": 1}, {"windows": 1}]}}}]}

    def test_original_literal_evidence_and_per_case_losses_are_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "dataset").mkdir()
            (root / "dataset/questions.json").write_text(json.dumps([
                {"id": "q", "split": "development", "type": "answerable", "gold_docs": ["d.md"],
                 "evidence": [{"doc": "d.md", "quote": "关键依据"}]}]))
            with patch.object(audit, "ROOT", root):
                result = audit.grade_replay(self.replay)
            body = next(r for r in result["summaries"] if r["strategy"] == "body")
            self.assertEqual(body["evidence_recall"], 0)
            self.assertEqual(body["all_sources_found"], 1)
            self.assertEqual(body["rule_lost"], 1)
            self.assertEqual(body["current_lost"], 1)

    def test_incomplete_duplicate_foreign_and_nonfinite_outputs_are_rejected(self):
        audit.validate_scores(self.scores, self.replay, self.protocol, "performance")
        for mutation in [lambda x: x.update(complete=False),
                         lambda x: x.update(protocol_sha256="wrong"),
                         lambda x: x["rows"].append(copy.deepcopy(x["rows"][0])),
                         lambda x: x["rows"][0].update(chunk_ids=["b", "a"]),
                         lambda x: x["rows"][0]["variants"]["title"].update(scores=[float("nan"), 0]),
                         lambda x: x["rows"][0]["variants"]["title"].update(scores=[1])]:
            changed = copy.deepcopy(self.scores)
            mutation(changed)
            with self.assertRaises(ValueError):
                audit.validate_scores(changed, self.replay, self.protocol, "performance")


class DecisionTests(unittest.TestCase):
    def summary(self, strategy, evidence, split="development", lost=0):
        return {"source": "v3-candidate", "split": split, "strategy": strategy,
                "evidence_recall": evidence, "all_evidence_found": evidence, "evidence_mrr": 1,
                "all_sources_found": 1, "rule_lost": lost, "current_lost": lost}

    def test_dev_winner_is_stopped_not_replaced_after_validation_failure(self):
        summaries = [self.summary(name, score, split, int(name == "body" and split == "validation"))
                     for split in ["development", "validation"]
                     for name, score in [("rule", .5), ("current", .8), ("body", .9), ("sections", .85)]]
        result = decide(summaries, [{"id": "body"}, {"id": "sections"}], "input")
        self.assertEqual(result["development_candidate"], "body")
        self.assertFalse(result["stage_passed"])
        self.assertFalse(result["production_accepted"])

    def test_diagnostic_caps_cannot_win_and_passing_input_requires_remaining_pools(self):
        summaries = [self.summary(name, score) for name, score in [("rule", .5), ("current", .8), ("body", .9), ("diagnostic", 1)]]
        result = decide(summaries, [{"id": "body"}, {"id": "diagnostic", "diagnostic": True}], "input")
        self.assertEqual(result["development_candidate"], "body")
        self.assertTrue(result["stage_passed"])
        self.assertFalse(result["production_accepted"])
        with self.assertRaisesRegex(ValueError, "missing development"):
            decide([], [{"id": "body"}], "input")


if __name__ == "__main__":
    unittest.main()
