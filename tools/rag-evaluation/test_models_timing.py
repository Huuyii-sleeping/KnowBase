from collections import Counter
from pathlib import Path
import tempfile
import unittest

from rerank_models_timing import benchmark, schedule


class TimingTests(unittest.TestCase):
    def test_schedule_balances_orders_and_repeats_every_case_model(self):
        cases = [{"source": "s", "id": str(n)} for n in range(12)]
        trials = schedule(cases, ["a", "b", "c"], 2)
        self.assertEqual(len(trials), 72)
        self.assertEqual(set(Counter((r["id"], r["model"]) for r in trials).values()), {2})
        for repeat in range(2):
            orders = [tuple(r["model"] for r in trials[i:i+3]) for i in range(repeat*36, (repeat+1)*36, 3)]
            self.assertEqual(set(Counter(orders).values()), {2})

    def test_failure_preserves_only_complete_trials_and_resume_checks_identity(self):
        class Fake:
            def score(self, query, pool):
                if query == "fail":
                    raise RuntimeError("failed")
                return {"scores": [1] * len(pool), "elapsed_ms": 1, "diagnostics": []}
        trials = [{"repeat": 0, "source": "s", "id": n, "model": "m"} for n in ["a", "b"]]
        tasks = {("s", n): {"query": "ok" if n == "a" else "fail", "pool": [{}], "pair_keys": [n]} for n in ["a", "b"]}
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            with self.assertRaises(RuntimeError):
                benchmark(trials, tasks, lambda _: Fake(), output)
            self.assertEqual(len((output / "timing-checkpoint.jsonl").read_text().splitlines()), 1)
            tasks["s", "b"]["query"] = "ok"
            rows = benchmark(trials, tasks, lambda _: Fake(), output)
            self.assertEqual(len(rows), 2)
            tasks["s", "a"]["pair_keys"] = ["changed"]
            with self.assertRaisesRegex(ValueError, "identity differs"):
                benchmark(trials, tasks, lambda _: Fake(), output)


if __name__ == "__main__":
    unittest.main()
