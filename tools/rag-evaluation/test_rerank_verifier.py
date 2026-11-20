import unittest

from rerank_verifier import validate_verdict


class VerifierTests(unittest.TestCase):
    def test_valid_empty_and_evidence_identity(self):
        self.assertEqual(validate_verdict({"answerable": False, "selected": []}, [{"id": "P0"}])["selected"], [])
        self.assertEqual(validate_verdict({"answerable": True, "selected": ["P0"]}, [{"id": "P0"}])["selected"], ["P0"])

    def test_foreign_duplicate_inconsistent_and_malformed_output_fails(self):
        for value in [None, {}, {"answerable": 1, "selected": []},
                      {"answerable": False, "selected": ["P0"]},
                      {"answerable": True, "selected": []},
                      {"answerable": True, "selected": ["P0", "P0"]},
                      {"answerable": True, "selected": ["other"]}]:
            with self.assertRaises(ValueError):
                validate_verdict(value, [{"id": "P0"}])


if __name__ == "__main__":
    unittest.main()
