import unittest

from rerank_refinement_input import input_windows


class Tokenizer:
    model_input_names = ["input_ids", "token_type_ids"]

    def encode(self, text, add_special_tokens=False):
        return list(map(ord, text))

    def num_special_tokens_to_add(self, pair=True):
        return 3

    def build_inputs_with_special_tokens(self, a, b):
        return [1, *a, 2, *b, 3]

    def create_token_type_ids_from_sequences(self, a, b):
        return [0] * (len(a) + 2) + [1] * (len(b) + 1)


class InputTests(unittest.TestCase):
    def setUp(self):
        self.config = {"query_tokens": 8, "title_tokens": 30, "max_length": 50, "overlap_tokens": 3}
        self.candidate = {"title": "标题", "content": "## 原章节\n" + "正文" * 70 + "尾部"}

    def test_body_has_no_metadata_prefix_and_preserves_tail(self):
        windows, stats = input_windows(Tokenizer(), "查询", self.candidate, self.config, "body")
        self.assertGreater(stats["windows"], 1)
        self.assertEqual(windows[0]["input_ids"][4:11], list(map(ord, "## 原章节\n")))
        self.assertEqual(windows[-1]["input_ids"][-3:-1], list(map(ord, "尾部")))
        self.assertTrue(all(len(w["input_ids"]) <= 50 for w in windows))
        self.assertTrue(all(len(w["token_type_ids"]) == len(w["input_ids"]) for w in windows))

    def test_sections_come_from_original_chunk_only(self):
        windows, stats = input_windows(Tokenizer(), "查询", self.candidate, self.config, "sections")
        prefix = "".join(map(chr, windows[0]["input_ids"][4:]))
        self.assertTrue(prefix.startswith("标题\n原章节\n"))
        self.assertEqual(stats["query_tokens_dropped"], 0)
        self.assertEqual(windows[-1]["input_ids"][-3:-1], list(map(ord, "尾部")))

    def test_failures_do_not_silently_truncate_or_substitute(self):
        with self.assertRaisesRegex(ValueError, "unsupported"):
            input_windows(Tokenizer(), "查询", self.candidate, self.config, "unknown")
        with self.assertRaisesRegex(ValueError, "nonempty"):
            input_windows(Tokenizer(), "", self.candidate, self.config, "body")
        with self.assertRaisesRegex(ValueError, "overlap"):
            input_windows(Tokenizer(), "查询", self.candidate, {**self.config, "max_length": 6}, "body")


if __name__ == "__main__":
    unittest.main()
