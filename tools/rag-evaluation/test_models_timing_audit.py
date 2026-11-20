import unittest

from rerank_model_input import fingerprint
from rerank_models_timing import schedule
from rerank_models_timing_audit import audit


class TimingAuditTests(unittest.TestCase):
    def fixture(self):
        protocol = {"models": [{"id": "bge-m3"}, {"id": "other"}],
                    "cases": [{"source": "s", "id": "q"}], "repeats": 2}
        rows = [{"trial": t, "pair_keys": ["pair"], "scores": [1], "diagnostics": [{}],
                 "elapsed_ms": 10 if t["model"] == "bge-m3" else 5}
                for t in schedule(protocol["cases"], ["bge-m3", "other"], 2)]
        result = {"complete": True, "protocol_sha256": fingerprint(protocol), "rows": rows}
        scores = {model: {"rows": [{"source": "s", "id": "q", "pair_keys": ["pair"],
                                   "scores": [1], "diagnostics": [{}]}]} for model in ["bge-m3", "other"]}
        return protocol, result, scores

    def test_paired_speed_and_score_identity(self):
        result = audit(*self.fixture())
        self.assertEqual(result["trials"], 4)
        self.assertEqual(result["max_score_difference_from_full_run"], 0)
        self.assertEqual(result["summaries"][1]["p50_reduction"], 0.5)

    def test_incomplete_foreign_or_invalid_timings_fail(self):
        for field, value in [("complete", False), ("protocol_sha256", "foreign")]:
            p, r, s = self.fixture()
            r[field] = value
            with self.assertRaises(ValueError):
                audit(p, r, s)
        for field, value in [("elapsed_ms", float("nan")), ("scores", []), ("pair_keys", ["changed"]), ("diagnostics", [])]:
            p, r, s = self.fixture()
            r["rows"][0][field] = value
            with self.assertRaises(ValueError):
                audit(p, r, s)
        p, r, s = self.fixture()
        r["rows"].reverse()
        with self.assertRaisesRegex(ValueError, "schedule differs"):
            audit(p, r, s)


if __name__ == "__main__":
    unittest.main()
