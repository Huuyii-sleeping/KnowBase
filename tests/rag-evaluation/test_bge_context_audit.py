import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools/rag-evaluation"))
from bge_context_audit import grade, validate_multi
from bge_integration_audit import fingerprint
import test_bge_integration_audit as fixture_module


class MultiContextAuditTests(unittest.TestCase):
    def fixture(self):
        protocol, single, original = fixture_module.ConsumptionAuditTests().fixture()
        multi = copy.deepcopy(single)
        multi["rows"][0].update(baseline_grounded=["a", "b"], bge_grounded=["b", "a"])
        return protocol, single, multi, original

    def test_two_facts_are_retained_without_conflating_with_generated_accuracy(self):
        protocol, single, multi, original = self.fixture()
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
            result = grade(root, protocol, multi, original, protocol, single)
        self.assertEqual(result["previous_single_context_loss_instances"], 1)
        self.assertEqual(result["unrecovered_previous_losses"], [])
        self.assertEqual(result["remaining_bge_vs_rule_multi_losses"], [])
        summary = result["summaries"][0]
        self.assertEqual(summary["strategies"]["bge_multi"]["evidence_recall"], 1)
        self.assertEqual(summary["changes"]["bge_fix"], {"gained": 1, "lost": 0})

    def test_rejects_missing_tampered_duplicate_external_and_overbudget_contexts(self):
        protocol, single, multi, original = self.fixture()
        mutations = [
            lambda x: x.update(rows=[]),
            lambda x: x.update(complete=False),
            lambda x: x.update(protocol_sha256="foreign"),
            lambda x: x["rows"][0].update(id="other"),
            lambda x: x["rows"][0].update(bge_grounded=["a", "a"]),
            lambda x: x["rows"][0].update(bge_grounded=["external"]),
        ]
        for mutation in mutations:
            altered = copy.deepcopy(multi)
            mutation(altered)
            with self.assertRaises(ValueError):
                validate_multi(protocol, altered, original)
        original["sources"][0]["rows"][0]["pool"][0]["content"] = "😀" * 3000
        with self.assertRaisesRegex(ValueError, "budget|context IDs"):
            validate_multi(protocol, multi, original)
