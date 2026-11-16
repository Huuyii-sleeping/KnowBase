import copy
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools/rag-evaluation"))
from benchmark_dataset import validate_dataset
from dataset_contract import dataset_coverage, validate_contract


class DatasetContractTests(unittest.TestCase):
    def setUp(self):
        self.directory = ROOT / "benchmarks/knowbase-recall-v3"
        self.manifest = json.loads((self.directory / "manifest.json").read_text())
        self.questions = json.loads((self.directory / "questions.json").read_text())
        self.contract = json.loads((self.directory / "protocol.json").read_text())[
            "dataset_contract"
        ]

    def test_frozen_evidence_coverage_and_disjoint_sources(self):
        validate_dataset(self.directory)
        coverage = validate_contract(self.manifest, self.questions, self.contract)
        self.assertEqual((coverage["documents"], coverage["questions"]), (158, 224))
        for split, count in [
            ("regression", 80),
            ("development", 96),
            ("validation", 48),
        ]:
            self.assertEqual(coverage["splits"][split]["questions"], count)
        self.assertEqual(
            coverage["splits"]["development"]["types"],
            {"answerable": 72, "unanswerable": 24},
        )
        self.assertEqual(
            coverage["splits"]["validation"]["types"],
            {"answerable": 36, "unanswerable": 12},
        )
        self.assertFalse(
            set(coverage["splits"]["development"]["families"])
            & set(coverage["splits"]["validation"]["families"])
        )

    def test_rejects_missing_coverage_provenance_negative_reasons_and_partition_leaks(
        self,
    ):
        def original():
            return copy.deepcopy(self.questions)

        cases = original()
        with self.assertRaisesRegex(ValueError, "counts"):
            validate_contract(self.manifest, cases[:-1], self.contract)
        positive = next(
            i
            for i, q in enumerate(cases)
            if q["split"] == "development" and q["category"] == "heading_context"
        )
        cases[positive].pop("section_heading")
        with self.assertRaisesRegex(ValueError, "section metadata"):
            validate_contract(self.manifest, cases, self.contract)
        cases = original()
        cases[positive]["origin"] = "real-user"
        with self.assertRaisesRegex(ValueError, "provenance"):
            validate_contract(self.manifest, cases, self.contract)
        cases = original()
        negative = next(
            q
            for q in cases
            if q["split"] == "development" and q["type"] == "unanswerable"
        )
        negative.pop("unanswerable_reason")
        with self.assertRaisesRegex(ValueError, "explanation"):
            validate_contract(self.manifest, cases, self.contract)
        cases = original()
        dev = next(q for q in cases if q["split"] == "development" and q["gold_docs"])
        val = next(q for q in cases if q["split"] == "validation" and q["gold_docs"])
        val["gold_docs"] = dev["gold_docs"]
        with self.assertRaisesRegex(ValueError, "disjoint"):
            validate_contract(self.manifest, cases, self.contract)
        cases = original()
        cases[positive]["family"] = "incorrect"
        with self.assertRaisesRegex(ValueError, "partition or family"):
            validate_contract(self.manifest, cases, self.contract)

    def test_v2_inputs_remain_unchanged_except_explicit_regression_annotations(self):
        old = ROOT / "benchmarks/knowbase-recall-v2"
        old_questions = json.loads((old / "questions.json").read_text())
        regression = self.questions[:80]
        for a, b in zip(old_questions, regression):
            for key, value in a.items():
                self.assertEqual(
                    b["previous_split"] if key == "split" else b[key], value
                )
        for entry in json.loads((old / "manifest.json").read_text())["documents"]:
            self.assertEqual(
                (old / "docs" / entry["file"]).read_bytes(),
                (self.directory / "docs" / entry["file"]).read_bytes(),
            )


if __name__ == "__main__":
    unittest.main()
