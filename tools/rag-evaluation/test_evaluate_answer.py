import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from evaluate_answer import evaluate_case


class AnswerEvaluationTest(unittest.TestCase):
    def test_answerable_case_requires_facts_and_gold_citation(self):
        case = {
            "id": "a1",
            "question": "问题",
            "type": "answerable",
            "gold_docs": ["guide.md"],
            "required_facts": ["检索", "生成"],
        }
        response = {
            "answer": "先检索，再生成。[S1]",
            "citations": [{"documentId": "doc-1"}],
            "contexts": [{"content": "检索后生成回答"}],
        }
        result = evaluate_case(case, response, {"guide.md": "doc-1"}, 10.0)
        self.assertTrue(result["passed"])
        self.assertEqual(result["citation_correctness"], 1.0)

    def test_unanswerable_case_requires_refusal_without_citation(self):
        case = {
            "id": "a2",
            "question": "未知问题",
            "type": "unanswerable",
            "gold_docs": [],
            "required_facts": [],
        }
        response = {
            "answer": "知识库中没有找到足够信息",
            "citations": [],
            "contexts": [],
        }
        result = evaluate_case(case, response, {}, 10.0)
        self.assertTrue(result["passed"])
        self.assertEqual(result["refusal_accuracy"], 1.0)

    def test_wrong_citation_fails_answerable_case(self):
        case = {
            "id": "a3",
            "question": "问题",
            "type": "answerable",
            "gold_docs": ["guide.md"],
            "required_facts": ["检索"],
        }
        response = {
            "answer": "检索结果如下。[S1]",
            "citations": [{"documentId": "noise-doc"}],
            "contexts": [],
        }
        result = evaluate_case(case, response, {"guide.md": "doc-1"}, 10.0)
        self.assertFalse(result["passed"])
        self.assertEqual(result["citation_correctness"], 0.0)

    def test_graph_case_requires_a_graph_context(self):
        case = {
            "id": "a4",
            "question": "RAG 和离线建库链路有什么关系？",
            "type": "answerable",
            "gold_docs": ["guide.md"],
            "required_facts": ["RAG", "离线建库链路"],
            "expected_context_source": "graph",
        }
        response = {
            "answer": "RAG 与离线建库链路存在关系。[S1]",
            "citations": [{"documentId": "doc-1", "sourceType": "graph"}],
            "contexts": [{"content": "实体路径：RAG -> 离线建库链路", "sourceType": "graph"}],
        }

        result = evaluate_case(case, response, {"guide.md": "doc-1"}, 10.0)

        self.assertTrue(result["passed"])
        self.assertEqual(result["context_source_correctness"], 1.0)

    def test_graph_case_fails_when_only_document_context_is_used(self):
        case = {
            "id": "a5",
            "question": "RAG 和离线建库链路有什么关系？",
            "type": "answerable",
            "gold_docs": ["guide.md"],
            "required_facts": ["RAG"],
            "expected_context_source": "graph",
        }
        response = {
            "answer": "RAG 是检索增强生成。[S1]",
            "citations": [{"documentId": "doc-1", "sourceType": "semantic"}],
            "contexts": [{"content": "RAG 是检索增强生成。", "sourceType": "semantic"}],
        }

        result = evaluate_case(case, response, {"guide.md": "doc-1"}, 10.0)

        self.assertFalse(result["passed"])
        self.assertEqual(result["context_source_correctness"], 0.0)


if __name__ == "__main__":
    unittest.main()
