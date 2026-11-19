import unittest

from rerank_window_diagnostic import partition_logits


class WindowDiagnosticTests(unittest.TestCase):
    def test_partition_preserves_window_order_and_negative_values(self):
        values = [-3, -1, 2]
        self.assertEqual(partition_logits(values, [{"windows": 2}, {"windows": 1}]), [[-3, -1], [2]])
        self.assertEqual(values, [-3, -1, 2])

    def test_reject_incomplete_nonfinite_and_invalid_counts(self):
        for values, diagnostics in [([1], [{"windows": 2}]), ([float("inf")], [{"windows": 1}]),
                                    ([], [{"windows": 0}]), ([1], [{"windows": True}])]:
            with self.assertRaises(ValueError):
                partition_logits(values, diagnostics)


if __name__ == "__main__":
    unittest.main()
