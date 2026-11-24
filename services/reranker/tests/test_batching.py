import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from knowbase_reranker.batching import length_batches


class BatchingTests(unittest.TestCase):
    def test_stable_length_groups_cover_every_original_offset_including_tail(self):
        windows = [{"input_ids": [0] * n} for n in [10, 2, 5, 2, 20]]
        self.assertEqual(list(length_batches(windows, 2)), [[1, 3], [2, 0], [4]])
        self.assertEqual([len(w["input_ids"]) for w in windows], [10, 2, 5, 2, 20])

    def test_empty_and_single_window(self):
        self.assertEqual(list(length_batches([], 8)), [])
        self.assertEqual(list(length_batches([{"input_ids": [1]}], 8)), [[0]])

    def test_invalid_batch_sizes_fail_even_without_windows(self):
        for size in [0, -1, 1.5, True, "8", None]:
            with self.subTest(size=size), self.assertRaises(ValueError):
                list(length_batches([], size))


if __name__ == "__main__":
    unittest.main()
