import sys
import unittest
from pathlib import Path
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

from knowbase_client import KnowBaseClient


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


class KnowBaseClientTest(unittest.TestCase):
    def test_login_and_answer_reuse_bearer_token(self):
        request_post = Mock(
            side_effect=[
                FakeResponse({"accessToken": "token-1"}),
                FakeResponse({"answer": "回答"}),
            ]
        )
        client = KnowBaseClient(
            "http://localhost:3000/api/v1", 10, request_post=request_post
        )

        client.login("admin", "secret")
        response, _ = client.answer("问题", 3)

        self.assertEqual(response["answer"], "回答")
        self.assertEqual(
            request_post.call_args.args[0], "http://localhost:3000/api/v1/rag/answer"
        )
        self.assertEqual(
            request_post.call_args.kwargs["headers"],
            {"Authorization": "Bearer token-1"},
        )

    def test_explicit_token_does_not_call_login_endpoint(self):
        request_post = Mock()
        client = KnowBaseClient(
            "http://localhost:3000/api/v1", 10, request_post=request_post
        )

        client.login(access_token="existing-token")

        request_post.assert_not_called()
        self.assertEqual(client.headers, {"Authorization": "Bearer existing-token"})

    def test_paginates_only_published_documents(self):
        request_get = Mock(
            side_effect=[
                FakeResponse({"items": [{"id": "first"}], "total": 2}),
                FakeResponse({"items": [{"id": "second"}], "total": 2}),
            ]
        )
        client = KnowBaseClient("http://test", 1, request_get=request_get)
        self.assertEqual(
            [item["id"] for item in client.list_documents()], ["first", "second"]
        )
        self.assertEqual(
            request_get.call_args.kwargs["params"],
            {"page": 2, "pageSize": 100, "status": "PUBLISHED"},
        )

    def test_pagination_failure_does_not_silently_drop_gold_documents(self):
        client = KnowBaseClient(
            "http://test",
            1,
            request_get=Mock(return_value=FakeResponse({"items": [], "total": 1})),
        )
        with self.assertRaisesRegex(ValueError, "pagination"):
            client.list_documents()

    def test_keyword_search_uses_get_and_preserves_auth(self):
        request_get = Mock(return_value=FakeResponse({"items": [{"id": "doc"}]}))
        client = KnowBaseClient("http://test", 1, request_get=request_get)
        client.login(access_token="test-token")
        items, _ = client.search("RabbitMQ", 3, "keyword")
        self.assertEqual(items, [{"id": "doc"}])
        self.assertEqual(request_get.call_args.args[0], "http://test/search/documents")
        self.assertEqual(request_get.call_args.kwargs["params"]["pageSize"], 3)
        self.assertEqual(
            request_get.call_args.kwargs["headers"]["Authorization"],
            "Bearer test-token",
        )

    def test_invalid_mode_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "unsupported"):
            KnowBaseClient("http://test", 1).search("query", 1, "unknown")


if __name__ == "__main__":
    unittest.main()
