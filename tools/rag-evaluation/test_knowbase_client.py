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
        request_post = Mock(side_effect=[
            FakeResponse({"accessToken": "token-1"}),
            FakeResponse({"answer": "回答"}),
        ])
        client = KnowBaseClient("http://localhost:3000/api/v1", 10, request_post=request_post)

        client.login("admin", "secret")
        response, _ = client.answer("问题", 3)

        self.assertEqual(response["answer"], "回答")
        self.assertEqual(request_post.call_args.args[0], "http://localhost:3000/api/v1/rag/answer")
        self.assertEqual(request_post.call_args.kwargs["headers"], {"Authorization": "Bearer token-1"})

    def test_explicit_token_does_not_call_login_endpoint(self):
        request_post = Mock()
        client = KnowBaseClient("http://localhost:3000/api/v1", 10, request_post=request_post)

        client.login(access_token="existing-token")

        request_post.assert_not_called()
        self.assertEqual(client.headers, {"Authorization": "Bearer existing-token"})


if __name__ == "__main__":
    unittest.main()
