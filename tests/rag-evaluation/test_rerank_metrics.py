import sys
import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools/rag-evaluation"))
from rerank_metrics import grade_selection, evidence_changes, baseline_losses, summarize
from rerank_audit import decide, analyze


class RerankMetricTests(unittest.TestCase):
    def test_evidence_retention_distinguishes_absent_pool_and_final_loss(self):
        q = {
            "gold_docs": ["a.md", "b.md"],
            "evidence": [
                {"doc": "a.md", "quote": "fact one"},
                {"doc": "b.md", "quote": "fact two"},
            ],
        }
        pool = [{"chunkId": "c", "documentId": "a", "content": "fact one"}]
        mapping = {"a.md": "a", "b.md": "b"}
        result = grade_selection(q, pool, pool, mapping)
        self.assertEqual(result["evidence_recall"], 0.5)
        self.assertEqual(result["pool_present_retention"], 1)
        self.assertEqual(result["evidence_mrr"], 1)
        self.assertEqual(
            evidence_changes(q, pool, [], mapping), {"gained": [], "lost": [0]}
        )
        losses = baseline_losses(
            q,
            pool,
            [],
            [{"chunkId": "c", "rank": 6, "score": 0.5, "reason": "top_k"}],
            mapping,
        )
        self.assertEqual([loss["evidence_index"] for loss in losses], [0])
        negative = grade_selection({"gold_docs": [], "evidence": []}, pool, [], mapping)
        self.assertIsNone(negative["evidence_recall"])
        self.assertIsNone(negative["pool_present_retention"])

    def test_decision_chooses_only_development_then_rejects_regression(self):
        protocol = {
            "strategies": [
                {"id": "rule"},
                {"id": "a"},
                {"id": "b"},
                {"id": "keyword-first", "diagnostic": True},
            ],
            "selection": {
                "source": "dev",
                "split": "development",
                "minimum_development_gain": 0.02,
            },
        }
        summaries = []
        for source, split, scores in [
            ("dev", "development", [0.5, 0.7, 0.6, 1]),
            ("check", "validation", [0.5, 0.6, 1, 1]),
        ]:
            for strategy, score in zip(["rule", "a", "b", "keyword-first"], scores):
                summaries.append(
                    {
                        "source": source,
                        "split": split,
                        "strategy": strategy,
                        "evidence_recall": score,
                        "all_evidence_found": score,
                        "evidence_mrr": score,
                        "evidence_lost": int(source == "check" and strategy == "a"),
                        "all_sources_found": score,
                    }
                )
        decision = decide(protocol, summaries)
        self.assertEqual(decision["development_candidate"], "a")
        self.assertFalse(decision["accepted"])
        self.assertFalse(decision["business_defaults_changed"])

    def test_full_audit_rejects_partial_or_fabricated_selections(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dataset = root / "dataset"
            (dataset / "docs").mkdir(parents=True)
            (dataset / "docs/a.md").write_text("fact one")
            (dataset / "manifest.json").write_text(
                json.dumps(
                    {
                        "version": "fixture",
                        "documents": [{"file": "a.md", "title": "A"}],
                    }
                )
            )
            question = {
                "id": "q",
                "question": "fact?",
                "type": "answerable",
                "category": "test",
                "split": "development",
                "gold_docs": ["a.md"],
                "evidence": [{"doc": "a.md", "quote": "fact one"}],
            }
            (dataset / "questions.json").write_text(json.dumps([question]))
            source = {"id": "dev", "dataset": "dataset"}
            protocol = {
                "sources": [source],
                "strategies": [{"id": "rule"}, {"id": "a"}],
                "selection": {
                    "source": "dev",
                    "split": "development",
                    "minimum_development_gain": 0.02,
                },
            }
            item = {"chunkId": "c", "documentId": "a", "content": "fact one"}
            selection = {
                "selected": ["c"],
                "elapsedMs": 1,
                "decisions": [
                    {"chunkId": "c", "rank": 1, "score": 1, "reason": "selected"}
                ],
            }
            row = {
                "id": "q",
                "pool": [item],
                "options": {"rule": selection, "a": copy.deepcopy(selection)},
            }
            replay = {
                "protocol_sha256": hashlib.sha256(
                    json.dumps(protocol, separators=(",", ":")).encode()
                ).hexdigest(),
                "sources": [
                    {
                        **source,
                        "metadata": {
                            "recall_audit": {"split": "all"},
                            "document_mapping": [{"file": "a.md", "id": "a"}],
                        },
                        "rows": [row],
                    }
                ],
            }
            result = analyze(root, protocol, replay)
            self.assertEqual(result["summaries"][0]["evidence_recall"], 1)
            self.assertFalse(result["decision"]["accepted"])
            self.assertEqual(result["summaries"][0]["offline_selection_p95_ms"], 1)
            row["options"]["a"]["selected"] = ["not-in-pool"]
            with self.assertRaisesRegex(ValueError, "selected items"):
                analyze(root, protocol, replay)
            row["options"]["a"]["selected"] = ["c"]
            replay["sources"][0]["rows"].append(row)
            with self.assertRaisesRegex(ValueError, "duplicate replay rows"):
                analyze(root, protocol, replay)
            replay["sources"][0]["rows"].pop()
            row["options"].pop("a")
            with self.assertRaisesRegex(ValueError, "incomplete replay strategies"):
                analyze(root, protocol, replay)


if __name__ == "__main__":
    unittest.main()
