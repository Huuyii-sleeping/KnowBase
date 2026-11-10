import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools/rag-evaluation"))

from benchmark_dataset import validate_dataset
from evaluate_retrieval import evaluate
from evaluation_types import EvaluationConfig
from question_set import document_lookup, load_questions
from report import write_outputs, write_trec_files
from run_matrix import run_matrix


class FixtureClient:
    def __init__(self, results):
        self.results = results

    def list_documents(self):
        return [
            {"id": "one", "fileName": "one.md", "status": "PUBLISHED"},
            {"id": "two", "fileName": "two.md", "status": "PUBLISHED"},
        ]

    def search(self, query, top_k, mode):
        return self.results[query][:top_k], 10.0


class RetrievalBaselineTests(unittest.TestCase):
    def run_cases(self, cases, results, mode="semantic", top_k=2):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            questions = root / "questions.json"
            questions.write_text(json.dumps(cases), encoding="utf-8")
            config = EvaluationConfig("http://test", questions, root, top_k, mode, 1)
            payload = evaluate(config, FixtureClient(results))
            write_outputs(payload, root)
            write_trec_files(payload, root)
            self.assertTrue((root / "retrieval-report.md").read_text())
            return payload

    def test_grades_api_order_even_when_native_scores_disagree(self):
        payload = self.run_cases(
            [{"id": "p", "question": "known", "gold_docs": ["one.md"]}],
            {"known": [{"id": "one", "score": 0.1}, {"id": "two", "score": 100}]},
        )
        self.assertEqual(payload["summary"]["mrr"], 1.0)
        self.assertEqual(payload["results"][0]["first_relevant_rank"], 1)

    def test_negatives_are_separate_from_positive_ranking_metrics(self):
        cases = [
            {"id": "p", "question": "known", "gold_docs": ["one.md"]},
            {"id": "n", "question": "unknown", "type": "unanswerable", "gold_docs": []},
        ]
        payload = self.run_cases(
            cases, {"known": [{"id": "one"}], "unknown": [{"id": "two"}]}
        )
        self.assertEqual(payload["summary"]["recall_at_k"], 1.0)
        self.assertEqual(payload["summary"]["hit_rate"], 1.0)
        self.assertEqual(payload["summary"]["negative_empty_rate"], 0.0)

    def test_all_negative_sets_have_no_artificial_ranking_score(self):
        payload = self.run_cases(
            [
                {
                    "id": "n",
                    "question": "unknown",
                    "type": "unanswerable",
                    "gold_docs": [],
                }
            ],
            {"unknown": []},
        )
        self.assertIsNone(payload["summary"]["recall_at_k"])
        self.assertEqual(payload["summary"]["negative_empty_rate"], 1.0)

    def test_extra_api_candidates_cannot_expand_the_scored_budget(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            questions = directory / "questions.json"
            questions.write_text(
                json.dumps([{"id": "p", "question": "known", "gold_docs": ["one.md"]}])
            )
            client = FixtureClient({})
            client.search = Mock(
                return_value=([{"id": "two"}, {"id": "two"}, {"id": "one"}], 10.0)
            )
            payload = evaluate(
                EvaluationConfig("http://test", questions, directory, 2, "semantic", 1),
                client,
            )
            self.assertEqual(payload["summary"]["recall_at_k"], 0.0)
            self.assertEqual(payload["results"][0]["api_result_count"], 2)
            self.assertEqual(payload["results"][0]["unique_document_count"], 1)

    def test_document_hit_does_not_imply_evidence_hit(self):
        case = {
            "id": "p",
            "question": "known",
            "gold_docs": ["one.md"],
            "evidence": [{"doc": "one.md", "quote": "critical fact"}],
        }
        missing = self.run_cases(
            [case], {"known": [{"documentId": "one", "content": "different paragraph"}]}
        )
        found = self.run_cases(
            [case],
            {
                "known": [
                    {"documentId": "one", "content": "different paragraph"},
                    {"documentId": "one", "content": "critical\nfact"},
                ]
            },
        )
        self.assertEqual(missing["summary"]["recall_at_k"], 1.0)
        self.assertEqual(missing["summary"]["evidence_recall"], 0.0)
        self.assertEqual(found["summary"]["evidence_recall"], 1.0)
        self.assertEqual(found["results"][0]["unique_document_count"], 1)

    def test_multi_document_partial_recall_and_keyword_evidence_not_applicable(self):
        case = {
            "id": "p",
            "question": "known",
            "gold_docs": ["one.md", "two.md"],
            "evidence": [
                {"doc": "one.md", "quote": "fact"},
                {"doc": "two.md", "quote": "other"},
            ],
        }
        payload = self.run_cases(
            [case], {"known": [{"id": "one"}]}, mode="keyword", top_k=1
        )
        self.assertEqual(payload["summary"]["recall_at_k"], 0.5)
        self.assertEqual(payload["summary"]["all_gold_hit_rate"], 0.0)
        self.assertIsNone(payload["summary"]["evidence_recall"])

    def test_question_validation_rejects_duplicate_ids_and_invalid_gold(self):
        for cases in [
            [{"id": "same", "question": "a", "gold_docs": ["one.md"]}] * 2,
            [{"id": "a", "question": "a", "gold_docs": []}],
            [
                {
                    "id": "a",
                    "question": "a",
                    "type": "unanswerable",
                    "gold_docs": ["one.md"],
                }
            ],
            [
                {
                    "id": "a",
                    "question": "a",
                    "gold_docs": ["one.md"],
                    "evidence": [{"doc": "two.md", "quote": "x"}],
                }
            ],
            ["not an object"],
            [{"id": "unsafe id", "question": "a", "gold_docs": ["one.md"]}],
            [{"id": "a", "question": "a", "gold_docs": ["one.md"], "category": []}],
            [{"id": "a", "question": "a", "gold_docs": "  "}],
        ]:
            with self.subTest(cases=cases), tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / "cases.json"
                path.write_text(json.dumps(cases))
                with self.assertRaises(ValueError):
                    load_questions(path)

    def test_ambiguous_published_filenames_fail_and_drafts_do_not_shadow_gold(self):
        documents = [
            {"id": "one", "fileName": "guide.md", "status": "PUBLISHED"},
            {"id": "two", "fileName": "guide.md", "status": "DRAFT"},
        ]
        self.assertEqual(document_lookup(documents), {"guide.md": "one"})
        documents[1]["status"] = "PUBLISHED"
        with self.assertRaisesRegex(ValueError, "ambiguous"):
            document_lookup(documents)

    def test_committed_dataset_has_literal_evidence_for_every_source(self):
        manifest = validate_dataset(ROOT / "benchmarks/knowbase-retrieval-v1")
        self.assertTrue(manifest["documents"])

    def test_matrix_warms_each_mode_and_writes_nine_runs_without_credentials(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            (directory / "questions.json").write_text(
                json.dumps([{"id": "p", "question": "known", "gold_docs": ["one.md"]}])
            )
            client = FixtureClient({"known": [{"id": "one", "score": 0.2}]})
            client.login = Mock()
            client.search = Mock(wraps=client.search)
            output = directory / "output"
            with patch("run_matrix.validate_dataset") as validate, patch(
                "run_matrix.KnowBaseClient", return_value=client
            ):
                payloads = run_matrix(
                    "http://test",
                    directory,
                    output,
                    "secret-token",
                    {"dataset": "fixture"},
                )
            validate.assert_called_once_with(directory)
            client.login.assert_called_once_with(access_token="secret-token")
            self.assertEqual(len(payloads), 9)
            self.assertEqual(
                [(call.args[2], call.args[1]) for call in client.search.call_args_list],
                [
                    (mode, k)
                    for mode in ("keyword", "semantic", "hybrid")
                    for k in (5, 1, 3, 5)
                ],
            )
            comparison = (output / "comparison.json").read_text()
            self.assertEqual(len(json.loads(comparison)["runs"]), 9)
            self.assertNotIn("secret-token", comparison)
            self.assertIn("N/A", (output / "comparison.md").read_text())
            self.assertEqual(len(list(output.glob("*/qrels.txt"))), 9)

    def test_dataset_rejects_missing_evidence_and_unsafe_filenames(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            (directory / "docs").mkdir()
            (directory / "docs/one.md").write_text("# one\nknown fact")
            manifest = {
                "version": "fixture",
                "documents": [{"file": "one.md", "title": "one"}],
            }
            (directory / "manifest.json").write_text(json.dumps(manifest))
            (directory / "questions.json").write_text(
                json.dumps(
                    [
                        {
                            "id": "q",
                            "question": "q",
                            "type": "answerable",
                            "gold_docs": ["one.md"],
                            "evidence": [{"doc": "one.md", "quote": "missing quote"}],
                        }
                    ]
                )
            )
            with self.assertRaisesRegex(ValueError, "verbatim"):
                validate_dataset(directory)
            manifest["documents"][0]["file"] = "../unsafe.md"
            (directory / "manifest.json").write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, "basenames"):
                validate_dataset(directory)


if __name__ == "__main__":
    unittest.main()
