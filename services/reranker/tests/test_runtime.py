import importlib.util
import http.client
import json
import math
import sys
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from knowbase_reranker.contract import MAX_BYTES, serialize_scores, validate_request
from knowbase_reranker.server import RerankServer
from knowbase_reranker.windows import pair_windows


def payload():
    return {
        "requestId": "r1",
        "query": "外组需要授权吗？",
        "candidates": [{"id": "c1", "title": "权限", "content": "外组需要逐人授权。"}],
    }


class ContractTests(unittest.TestCase):
    def test_normal_serialization_retains_identity_and_negative_scores(self):
        body = payload()
        self.assertEqual(
            validate_request(body), ("r1", body["query"], body["candidates"])
        )
        result = serialize_scores("r1", body["candidates"], {"scores": [-5.5]})
        self.assertEqual(result["scores"], [{"id": "c1", "score": -5.5}])
        self.assertEqual(result["requestId"], "r1")

    def test_invalid_requests_and_model_outputs_fail_completely(self):
        invalid = [
            None,
            [],
            {},
            {**payload(), "query": " "},
            {**payload(), "query": "q" * 2049},
            {**payload(), "requestId": 5},
            {**payload(), "candidates": []},
        ]
        for field, value in [
            ("id", ""),
            ("content", None),
            ("title", 1),
            ("content", "a" * 20001),
        ]:
            body = payload()
            body["candidates"][0][field] = value
            invalid.append(body)
        body = payload()
        body["candidates"] *= 2
        invalid.append(body)
        for body in invalid:
            with self.subTest(body_type=type(body).__name__):
                with self.assertRaises(ValueError):
                    validate_request(body)
        for scores in [[], [math.nan], [math.inf], [True], ["1"]]:
            with self.assertRaises(ValueError):
                serialize_scores("r1", payload()["candidates"], {"scores": scores})


class FakeModel:
    def score(self, query, candidates):
        return {"scores": [-1.5] * len(candidates)}


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.server = RerankServer(("127.0.0.1", 0), FakeModel())
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.origin = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, value, path="/rerank", content_type="application/json"):
        data = json.dumps(value).encode()
        request = Request(self.origin + path, data, {"Content-Type": content_type})
        with urlopen(request, timeout=2) as response:
            return json.load(response)

    def test_health_and_request_use_the_real_http_contract(self):
        with urlopen(self.origin + "/health", timeout=2) as response:
            self.assertTrue(json.load(response)["ready"])
        self.assertEqual(
            self.request(payload())["scores"], [{"id": "c1", "score": -1.5}]
        )

    def test_invalid_paths_bodies_and_oversized_input_are_rejected(self):
        for body, path, content_type, status in [
            (payload(), "/missing", "application/json", 404),
            (payload(), "/rerank", "text/plain", 415),
            ({}, "/rerank", "application/json", 400),
        ]:
            with self.assertRaises(HTTPError) as error:
                self.request(body, path, content_type)
            self.assertEqual(error.exception.code, status)

    def test_oversized_length_is_rejected_before_reading_or_sending_body(self):
        connection = http.client.HTTPConnection(
            "127.0.0.1", self.server.server_port, timeout=2
        )
        try:
            connection.putrequest("POST", "/rerank")
            connection.putheader("Content-Type", "application/json")
            connection.putheader("Content-Length", str(MAX_BYTES + 1))
            connection.endheaders()
            self.assertEqual(connection.getresponse().status, 413)
        finally:
            connection.close()

    def test_busy_and_model_failures_release_lock_and_later_requests_recover(self):
        self.server.inference.acquire()
        with self.assertRaises(HTTPError) as error:
            self.request(payload())
        self.assertEqual(error.exception.code, 503)
        self.server.inference.release()

        class Broken:
            def score(self, *_):
                raise RuntimeError("private model input")

        self.server.model = Broken()
        with self.assertRaises(HTTPError) as error:
            self.request(payload())
        self.assertEqual(error.exception.code, 503)
        self.assertNotIn(b"private", error.exception.read())
        self.server.model = FakeModel()
        self.assertEqual(self.request(payload())["requestId"], "r1")

    def test_parallel_requests_do_not_queue_inference(self):
        started, release = threading.Event(), threading.Event()

        class Slow:
            def score(self, query, candidates):
                started.set()
                release.wait(2)
                return {"scores": [1] * len(candidates)}

        self.server.model = Slow()
        result = []
        first = threading.Thread(target=lambda: result.append(self.request(payload())))
        first.start()
        self.assertTrue(started.wait(1))
        try:
            with self.assertRaises(HTTPError) as error:
                self.request(payload())
            self.assertEqual(error.exception.code, 503)
        finally:
            release.set()
            first.join()
        self.assertEqual(result[0]["scores"][0]["score"], 1)


class Tokenizer:
    model_input_names = ["input_ids", "attention_mask", "token_type_ids"]

    def encode(self, text, **_):
        return list(text.encode())

    def num_special_tokens_to_add(self, **_):
        return 3

    def build_inputs_with_special_tokens(self, query, passage):
        return [1000, *query, 1001, *passage, 1002]

    def create_token_type_ids_from_sequences(self, query, passage):
        return [0] * (len(query) + 2) + [1] * (len(passage) + 1)


class FrozenInputParityTests(unittest.TestCase):
    def test_window_input_matches_frozen_experiment_without_modifying_archived_code(
        self,
    ):
        archived_path = (
            Path(__file__).resolve().parents[3]
            / "tools/rag-evaluation/rerank_model_input.py"
        )
        spec = importlib.util.spec_from_file_location("archived_windows", archived_path)
        archived = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(archived)
        config = {
            "query_tokens": 3,
            "title_tokens": 2,
            "max_length": 16,
            "overlap_tokens": 2,
        }
        for body in ["", "abc", "abcdef" * 10, "逐人授权" * 20]:
            self.assertEqual(
                pair_windows(Tokenizer(), "query", "title", body, config),
                archived.pair_windows(Tokenizer(), "query", "title", body, config),
            )
        with self.assertRaises(ValueError):
            pair_windows(
                Tokenizer(), "q", "t", "body", {**config, "overlap_tokens": 20}
            )


if __name__ == "__main__":
    unittest.main()
