import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import rerank_trials_audit as trial


class TrialAuditTests(unittest.TestCase):
    def test_negative_abstention_is_reported_separately_from_evidence_loss(self):
        def row(kind, count, changes):
            return {"type": kind, "selected_count": count, "characters": count * 10,
                    "top1_hit": count > 0, "metrics": {"evidence_recall": 1 if count else 0,
                    "all_sources_found": count > 0}, "vs_current": changes,
                    "rejection_reasons": ["weak_score"] if not count else []}
        result = trial.summarize([
            row("answerable", 0, {"gained": [], "lost": [0]}),
            row("answerable", 1, {"gained": [], "lost": []}),
            row("unanswerable", 0, {"gained": [], "lost": []}),
        ])
        self.assertEqual(result["evidence_recall"], 0.5)
        self.assertEqual(result["negative_empty_rate"], 1)
        self.assertEqual(result["answerable_empty_rate"], 0.5)
        self.assertEqual(result["lost"], 1)
        self.assertEqual(result["rejection_reasons"], {"weak_score": 2})

    def test_audit_retains_original_evidence_and_missing_selections_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            q = {"id": "q", "question": "question", "split": "development", "type": "answerable",
                 "evidence": [{"doc": "a.md", "quote": "500"}]}
            (root / "questions.json").write_text(json.dumps([q]))
            replay = {"sources": [{"id": "s", "dataset": ".", "rows": [
                {"id": "q", "options": {"cutoff": {"selected": [], "characters": 0,
                 "decisions": [{"reason": "weak_score"}]}}}]}]}
            detail = {"source": "s", "id": "q", "strategy": "cutoff", "split": "development",
                      "metrics": {"evidence_recall": 0, "all_sources_found": False}, "top1_hit": False,
                      "vs_current": {"gained": [], "lost": [0]}}
            with patch.object(trial, "ROOT", root), patch.object(trial, "grade_replay", return_value={"details": [detail]}):
                result = trial.audit(replay)
                self.assertEqual(result["changes"][0]["lost"], q["evidence"])
                self.assertIsNone(result["overall"]["cutoff"]["negative_empty_rate"])
                del replay["sources"][0]["rows"][0]["options"]["cutoff"]["selected"]
                with self.assertRaises(KeyError):
                    trial.audit(replay)


if __name__ == "__main__":
    unittest.main()
