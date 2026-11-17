import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools/rag-evaluation"))
from rerank_model_input import aggregate_scores, pair_key, pair_windows
from rerank_model_cache import run_tasks


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


CONFIG = {"query_tokens": 3, "title_tokens": 2, "max_length": 16, "overlap_tokens": 2}


class WindowTests(unittest.TestCase):
    def test_overlap_covers_tail_and_repeats_title_with_bounded_pair(self):
        body = "abcdefghijklmnopqrstuvw"
        windows, stats = pair_windows(Tokenizer(), "query", "Title", body, CONFIG)
        # Capacity is 8; windows cover [0:8], [6:14], [12:20], [18:23].
        self.assertEqual(
            [w["input_ids"][7:-1] for w in windows],
            [
                list(body[a:b].encode())
                for a, b in [(0, 8), (6, 14), (12, 20), (18, 23)]
            ],
        )
        self.assertTrue(all(len(w["input_ids"]) <= 16 for w in windows))
        self.assertTrue(all(w["input_ids"][5:7] == list(b"Ti") for w in windows))
        self.assertTrue(
            all(len(w["token_type_ids"]) == len(w["input_ids"]) for w in windows)
        )
        self.assertEqual(stats["query_tokens_dropped"], 2)
        self.assertEqual(stats["title_tokens_dropped"], 4)
        self.assertEqual(stats["body_tokens"], len(body))
        self.assertEqual(aggregate_scores([1, 9, 2, 3, 5], [4, 1]), [9, 5])

    def test_empty_body_and_invalid_inputs_and_nonfinite_output(self):
        windows, stats = pair_windows(Tokenizer(), "q", "t", "", CONFIG)
        self.assertEqual(len(windows), 1)
        self.assertEqual(stats["body_tokens"], 0)
        for query, title in [("", "title"), ("q", None)]:
            with self.assertRaises(ValueError):
                pair_windows(Tokenizer(), query, title, "body", CONFIG)
        with self.assertRaises(ValueError):
            pair_windows(
                Tokenizer(), "q", "t", "body", {**CONFIG, "overlap_tokens": 99}
            )
        for scores, counts in [([float("nan")], [1]), ([1], [2]), ([], [0])]:
            with self.assertRaises(ValueError):
                aggregate_scores(scores, counts)
        self.assertNotEqual(
            pair_key("q", {"title": "a", "content": "b"}),
            pair_key("q", {"title": "a", "content": "c"}),
        )


class FakeModel:
    def __init__(self, fail=False):
        self.calls = 0
        self.fail = fail

    def score(self, query, candidates):
        self.calls += 1
        if self.fail and query == "second":
            raise RuntimeError("inference failed")
        return {
            "scores": [float(len(p["content"])) for p in candidates],
            "diagnostics": [{"windows": 1} for _ in candidates],
            "elapsed_ms": 1,
        }


class CheckpointTests(unittest.TestCase):
    def task(self, query, identifier):
        pool = [{"title": "Title", "content": "Body"}]
        return {
            "source": "s",
            "id": identifier,
            "query": query,
            "pool": pool,
            "pair_keys": [pair_key(query, p) for p in pool],
        }

    def test_failure_preserves_complete_prefix_then_resume_and_reuse(self):
        tasks = [
            self.task("first", "1"),
            self.task("second", "2"),
            self.task("first", "3"),
        ]
        with tempfile.TemporaryDirectory() as tmp:
            checkpoint = Path(tmp) / "rows.jsonl"
            with self.assertRaisesRegex(RuntimeError, "inference failed"):
                run_tasks(tasks, checkpoint, lambda: FakeModel(fail=True))
            self.assertEqual(len(checkpoint.read_text().splitlines()), 1)
            model = FakeModel()
            records = run_tasks(tasks, checkpoint, lambda: model)
            self.assertEqual(len(records), 3)
            self.assertEqual(model.calls, 2)  # health input and missing second pair
            self.assertEqual(records[2]["cached_pairs"], 1)
            self.assertEqual(records[2]["elapsed_ms"], 0)
            self.assertEqual(
                run_tasks(tasks, checkpoint, lambda: self.fail("should not load")),
                records,
            )
            damaged = json.loads(checkpoint.read_text().splitlines()[0])
            damaged["pair_keys"] = ["changed"]
            checkpoint.write_text(json.dumps(damaged) + "\n")
            with self.assertRaisesRegex(ValueError, "checkpoint task differs"):
                run_tasks(
                    tasks, checkpoint, lambda: self.fail("must validate before loading")
                )


if __name__ == "__main__":
    unittest.main()
