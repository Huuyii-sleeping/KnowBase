import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools/rag-evaluation"))
from recall_loss import locate_loss, route_details


class RecallLossTests(unittest.TestCase):
    def test_locates_each_boundary_and_legacy_unknown(self):
        names = [
            "indexed",
            "keyword_raw",
            "semantic_raw",
            "keyword_eligible",
            "semantic_eligible",
            "keyword",
            "semantic",
            "pool",
            "selected",
        ]

        def stages(*hits):
            return {name: {"evidence_hits": [name in hits]} for name in names}

        for hits, expected in [
            ([], "missing_or_split_in_index"),
            (["indexed"], "not_in_raw_candidates"),
            (["indexed", "keyword_raw"], "metadata_filter"),
            (["indexed", "keyword_raw", "keyword_eligible"], "route_budget"),
            (["indexed", "semantic_raw", "semantic_eligible"], "route_budget"),
            (["indexed", "keyword_raw", "keyword"], "merge_loss"),
            (["indexed", "keyword_raw", "keyword", "pool"], "selection_loss"),
            (names, None),
        ]:
            self.assertEqual(locate_loss(stages(*hits), 0), expected)
        legacy = stages("indexed", "keyword_raw")
        del legacy["keyword_eligible"], legacy["semantic_eligible"]
        self.assertEqual(locate_loss(legacy, 0), "filtered_or_route_budget")

    def test_evidence_ranks_require_source_body_and_preserve_uncertainty(self):
        evidence = {"doc": "one.md", "quote": "actual fact"}
        chunk = {"documentId": "one", "content": "actual\nfact"}
        noise = {"documentId": "two", "content": "actual fact"}
        trace = {
            "keyword": {
                "rawCandidates": [noise, chunk],
                "eligibleCandidates": [chunk],
                "items": [],
            },
            "semantic": {
                "rawCandidates": [chunk],
                "eligibleCandidates": [],
                "items": [],
            },
        }
        result = route_details(evidence, trace, {"one.md": "one"})
        self.assertEqual(
            result["keyword"],
            {
                "raw_rank": 2,
                "eligible_rank": 1,
                "retained_rank": None,
                "reason": "route_budget",
            },
        )
        self.assertEqual(result["semantic"]["reason"], "metadata_filter")
        trace["keyword"]["items"] = [chunk]
        self.assertEqual(
            route_details(evidence, trace, {"one.md": "one"})["keyword"]["reason"],
            "retained",
        )
        del trace["semantic"]["eligibleCandidates"]
        self.assertEqual(
            route_details(evidence, trace, {"one.md": "one"})["semantic"]["reason"],
            "filtered_or_route_budget",
        )
