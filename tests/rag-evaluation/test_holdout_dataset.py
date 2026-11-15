import hashlib
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools/rag-evaluation"))
from benchmark_dataset import validate_dataset
from dataset_contract import dataset_coverage


class HoldoutDatasetTests(unittest.TestCase):
    def setUp(self):
        self.directory = ROOT / "benchmarks/knowbase-holdout-v1"
        self.manifest = validate_dataset(self.directory)
        self.questions = json.loads((self.directory / "questions.json").read_text())

    def test_frozen_literal_evidence_coverage_and_long_sources(self):
        freeze = json.loads((self.directory / "freeze.json").read_text())
        for name, digest in freeze["files"].items():
            self.assertEqual(
                hashlib.sha256((self.directory / name).read_bytes()).hexdigest(),
                digest,
                name,
            )
        self.assertEqual(
            hashlib.sha256(
                (self.directory / "experiments/protocol.json").read_bytes()
            ).hexdigest(),
            freeze["protocol_sha256"],
        )
        coverage = dataset_coverage(self.manifest, self.questions)
        self.assertEqual((coverage["documents"], coverage["questions"]), (40, 80))
        self.assertEqual(len(coverage["splits"]["validation"]["families"]), 8)
        for q in self.questions:
            if q["category"] == "cross_chunk":
                self.assertEqual(len(q["evidence"]), 2)
                body = (self.directory / "docs" / q["gold_docs"][0]).read_text()
                self.assertGreater(
                    body.index(q["evidence"][1]["quote"])
                    - body.index(q["evidence"][0]["quote"]),
                    1000,
                )

    def test_prior_sources_titles_questions_and_families_are_not_reused(self):
        bodies = {
            (self.directory / "docs" / d["file"]).read_text().strip()
            for d in self.manifest["documents"]
        }
        titles = {d["title"] for d in self.manifest["documents"]}
        families = {q["family"] for q in self.questions}
        questions = {q["question"].strip() for q in self.questions}
        for manifest_path in (ROOT / "benchmarks").glob("*/manifest.json"):
            if manifest_path.parent == self.directory:
                continue
            previous = json.loads(manifest_path.read_text())
            for d in previous["documents"]:
                self.assertNotIn(d["title"], titles)
                self.assertNotIn(d.get("family"), families)
                self.assertNotIn(
                    (manifest_path.parent / "docs" / d["file"]).read_text().strip(),
                    bodies,
                )
            for q in json.loads((manifest_path.parent / "questions.json").read_text()):
                self.assertNotIn(q["question"].strip(), questions)
                self.assertNotIn(q.get("family"), families)


if __name__ == "__main__":
    unittest.main()
