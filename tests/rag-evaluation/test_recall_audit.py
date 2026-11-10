import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools/rag-evaluation"))
from recall_audit import analyze, grade
from recall_report import render_report
from benchmark_dataset import validate_dataset


class RecallAuditTests(unittest.TestCase):
    def test_grades_actual_evidence_and_multiple_sources_without_using_document_title(
        self,
    ):
        question = {
            "gold_docs": ["one.md", "two.md"],
            "evidence": [
                {"doc": "one.md", "quote": "关键 证据"},
                {"doc": "two.md", "quote": "other"},
            ],
        }
        result = grade(
            question,
            [
                {"documentId": "one", "content": "关键\n证据"},
                {"documentId": "two", "content": "irrelevant"},
            ],
            {"one.md": "one", "two.md": "two"},
        )
        self.assertEqual(result["document_recall"], 1)
        self.assertEqual(result["evidence_recall"], 0.5)
        self.assertFalse(result["all_evidence_found"])
        self.assertIsNone(grade({"gold_docs": []}, [], {})["document_recall"])

    def test_stage_attribution_excludes_negatives_and_rejects_partial_runs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "docs").mkdir()
            (root / "docs/one.md").write_text("fact first and fact second")
            (root / "manifest.json").write_text(
                json.dumps(
                    {
                        "version": "fixture",
                        "documents": [{"file": "one.md", "title": "One"}],
                    }
                )
            )
            cases = [
                {
                    "id": "p",
                    "type": "answerable",
                    "category": "test",
                    "split": "development",
                    "question": "known",
                    "gold_docs": ["one.md"],
                    "evidence": [
                        {"doc": "one.md", "quote": "fact first"},
                        {"doc": "one.md", "quote": "fact second"},
                    ],
                },
                {
                    "id": "n",
                    "type": "unanswerable",
                    "category": "negative",
                    "split": "development",
                    "question": "unknown",
                    "gold_docs": [],
                    "evidence": [],
                },
            ]
            (root / "questions.json").write_text(json.dumps(cases))
            (root / "metadata.json").write_text(
                json.dumps(
                    {
                        "document_mapping": [{"file": "one.md", "id": "one"}],
                        "recall_audit": {"budgets": [15], "split": "development"},
                    }
                )
            )
            chunks = [
                {"documentId": "one", "content": "fact first"},
                {"documentId": "one", "content": "fact second"},
            ]
            (root / "indexed-corpus.json").write_text(json.dumps(chunks))
            traces = [
                {
                    "id": case["id"],
                    "budget": 15,
                    "keyword": {
                        "rawCandidates": chunks,
                        "items": chunks[:1],
                        "elapsedMs": 1,
                    },
                    "semantic": {"rawCandidates": [], "items": [], "elapsedMs": 2},
                    "pool": chunks[:1],
                    "selected": [],
                    "elapsedMs": 3,
                }
                for case in cases
            ]
            path = root / "recall-traces.json"
            path.write_text(json.dumps(traces))
            payload = analyze(root, root)
            summary = payload["summaries"][0]
            self.assertEqual(summary["stages"]["pool"]["evidence_recall"], 0.5)
            self.assertEqual(summary["stages"]["selected"]["evidence_recall"], 0)
            self.assertEqual(summary["stages"]["selected"]["negative_empty_rate"], 1)
            self.assertEqual(
                [loss["cause"] for loss in payload["results"][0]["losses"]],
                ["selection_loss", "filtered_or_route_budget"],
            )
            self.assertTrue((root / "recall-audit.md").read_text())
            path.write_text(json.dumps(traces[:1]))
            with self.assertRaisesRegex(ValueError, "incomplete"):
                analyze(root, root)

    def test_markdown_report_handles_negative_only_metrics_and_selected_budget(self):
        stages = {
            stage: {"evidence_recall": None, "mean_candidate_count": 2}
            for stage in ("keyword", "semantic", "pool", "selected")
        }
        summary = {
            "split": "validation",
            "budget_per_route": 10,
            "stages": stages,
            "mean_ms": 3,
            "p95_ms": 4,
        }
        text = render_report([summary], [], [10], 10)
        self.assertIn("N/A", text)
        self.assertIn("每路 10 候选", text)
        self.assertNotIn("默认 15", text)

    def test_expanded_corpus_has_valid_evidence_and_disjoint_question_identifiers(self):
        directory = ROOT / "benchmarks/knowbase-recall-v2"
        manifest = validate_dataset(directory)
        self.assertEqual(len(manifest["documents"]), 134)
        cases = json.loads((directory / "questions.json").read_text())
        self.assertEqual(len(cases), 80)
        self.assertEqual(len({q["question"] for q in cases}), 80)
        self.assertEqual(sum(q["split"] == "validation" for q in cases), 40)


if __name__ == "__main__":
    unittest.main()
