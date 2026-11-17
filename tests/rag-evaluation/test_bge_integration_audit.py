import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools/rag-evaluation"))
from bge_integration_audit import fingerprint, grade, validate_rows


class ConsumptionAuditTests(unittest.TestCase):
    def fixture(self):
        original = {
            "sources": [
                {
                    "id": "s",
                    "dataset": "dataset",
                    "metadata": {
                        "document_mapping": [{"file": "rules.md", "id": "doc"}]
                    },
                    "rows": [
                        {
                            "id": "q",
                            "pool": [
                                {
                                    "chunkId": "a",
                                    "documentId": "doc",
                                    "content": "first required fact",
                                },
                                {
                                    "chunkId": "b",
                                    "documentId": "doc",
                                    "content": "second required fact",
                                },
                            ],
                            "options": {
                                "rule": {"selected": ["a", "b"]},
                                "bge-m3-anchor2-model-order": {"selected": ["b", "a"]},
                            },
                        }
                    ],
                }
            ]
        }
        protocol = {"frozen": True}
        replay = {
            "complete": True,
            "mode": "replay",
            "protocol_sha256": fingerprint(protocol),
            "rows": [
                {
                    "source": "s",
                    "id": "q",
                    "selected": ["b", "a"],
                    "baseline_grounded": ["a"],
                    "bge_grounded": ["b"],
                }
            ],
        }
        return protocol, replay, original

    def test_same_top5_can_gain_one_subfact_and_lose_another_in_single_context(self):
        protocol, replay, original = self.fixture()
        question = {
            "id": "q",
            "split": "development",
            "type": "answerable",
            "gold_docs": ["rules.md"],
            "evidence": [
                {"doc": "rules.md", "quote": "first required fact"},
                {"doc": "rules.md", "quote": "second required fact"},
            ],
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "dataset").mkdir()
            (root / "dataset/questions.json").write_text(json.dumps([question]))
            result = grade(root, protocol, replay, original)
        self.assertEqual(result["summaries"][0]["evidence_gained"], 1)
        self.assertEqual(result["summaries"][0]["evidence_lost"], 1)
        self.assertEqual(
            result["all_grounded_losses"][0]["changes"], {"gained": [1], "lost": [0]}
        )
        self.assertEqual(result["summaries"][0]["bge_grounded_evidence_recall"], 0.5)

    def test_rejects_incomplete_foreign_duplicate_or_pool_external_results(self):
        protocol, replay, original = self.fixture()
        mutations = [
            lambda x: x.update(complete=False),
            lambda x: x.update(protocol_sha256="foreign"),
            lambda x: x.update(rows=[]),
            lambda x: x["rows"][0].update(id="wrong"),
            lambda x: x["rows"][0].update(selected=["a", "b"]),
            lambda x: x["rows"][0].update(bge_grounded=["outside"]),
            lambda x: x["rows"][0].update(baseline_grounded=["a", "b"]),
        ]
        for mutate in mutations:
            changed = copy.deepcopy(replay)
            mutate(changed)
            with self.assertRaises(ValueError):
                validate_rows(protocol, changed, original)
        replay["rows"][0]["bge_grounded"] = []
        validate_rows(protocol, replay, original)


if __name__ == "__main__":
    unittest.main()
