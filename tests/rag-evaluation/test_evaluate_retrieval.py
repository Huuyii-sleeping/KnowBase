import importlib.util
import json
import sys
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).parents[2] / "tools" / "rag-evaluation" / "evaluate_retrieval.py"
sys.path.insert(0, str(MODULE_PATH.parent))
SPEC = importlib.util.spec_from_file_location("evaluate_retrieval", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


class FakeClient(MODULE.KnowBaseClient):
    def __init__(self):
        super().__init__("http://test/api/v1", 1)

    def list_documents(self):
        return [{"id": "doc-1", "fileName": "rag_basics.md", "title": "RAG 基础"}]

    def search(self, query, top_k, mode):
        return [
            {"documentId": "doc-2", "title": "噪声", "rerankScore": 0.9},
            {"documentId": "doc-1", "title": "RAG 基础", "rerankScore": 0.8},
        ][:top_k], 12.5


class RetrievalEvaluationTests(unittest.TestCase):
    def test_gold_documents_are_resolved_and_metrics_are_standard(self):
        config = MODULE.EvaluationConfig(
            base_url="http://test/api/v1",
            questions_path=Path("/tmp/questions.json"),
            output_dir=Path("/tmp/report"),
            top_k=2,
            mode="hybrid",
            timeout_seconds=1,
        )
        config.questions_path.write_text(
            json.dumps([{"id": "q1", "question": "问题", "gold_doc": "rag_basics.md"}],
                       ensure_ascii=False),
            encoding="utf-8",
        )
        payload = MODULE.evaluate(config, FakeClient())
        self.assertEqual(payload["summary"]["questions"], 1)
        self.assertEqual(payload["summary"]["recall_at_k"], 1.0)
        self.assertEqual(payload["summary"]["mrr"], 0.5)
        self.assertEqual(payload["results"][0]["gold_document_ids"], ["doc-1"])

    def test_missing_published_gold_document_fails_loudly(self):
        config = MODULE.EvaluationConfig(
            base_url="http://test/api/v1",
            questions_path=Path("/tmp/questions-missing.json"),
            output_dir=Path("/tmp/report"),
            top_k=2,
            mode="hybrid",
            timeout_seconds=1,
        )
        config.questions_path.write_text(
            json.dumps([{"id": "q1", "question": "问题", "gold_doc": "missing.md"}]),
            encoding="utf-8",
        )
        with self.assertRaisesRegex(ValueError, "missing.md"):
            MODULE.evaluate(config, FakeClient())


if __name__ == "__main__":
    unittest.main()
