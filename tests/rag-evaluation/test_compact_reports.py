import gzip
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools/rag-evaluation"))
from compact_reports import compact_trace, completed_trace


class CompactReportTests(unittest.TestCase):
    def fixture(self, directory, status="completed"):
        path = Path(directory) / "recall-traces.json"
        path.write_text(
            json.dumps([{"content": "中文原始正文" * 100}], ensure_ascii=False)
        )
        (path.parent / "run-status.json").write_text(json.dumps({"status": status}))
        return path

    def test_round_trip_preserves_exact_bytes_and_deletes_only_verified_original(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self.fixture(tmp)
            original = path.read_bytes()
            result = compact_trace(path)
            target = path.with_suffix(".json.gz")
            self.assertFalse(path.exists())
            self.assertEqual(gzip.decompress(target.read_bytes()), original)
            self.assertEqual(
                result["sha256_uncompressed"], hashlib.sha256(original).hexdigest()
            )
            self.assertLess(result["after_bytes"], result["before_bytes"])
            self.assertFalse(list(Path(tmp).glob(".recall-traces-*")))

    def test_failed_or_running_runs_and_existing_archives_are_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            for status in ["failed", "running"]:
                path = self.fixture(tmp, status)
                self.assertFalse(completed_trace(path))
                with self.assertRaisesRegex(ValueError, "completed"):
                    compact_trace(path)
                self.assertTrue(path.is_file())
            path = self.fixture(tmp)
            target = path.with_suffix(".json.gz")
            target.write_bytes(b"previous archive")
            with self.assertRaises(FileExistsError):
                compact_trace(path)
            self.assertTrue(path.is_file())
            self.assertEqual(target.read_bytes(), b"previous archive")
            link = Path(tmp) / "other" / "recall-traces.json"
            link.parent.mkdir()
            link.symlink_to(path)
            self.assertFalse(completed_trace(link))

    def test_checksum_failure_keeps_original_and_cleans_partial_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self.fixture(tmp)
            original = path.read_bytes()
            with patch("compact_reports.digest", side_effect=["original", "corrupt"]):
                with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                    compact_trace(path)
            self.assertEqual(path.read_bytes(), original)
            self.assertFalse(path.with_suffix(".json.gz").exists())
            self.assertFalse(list(Path(tmp).glob(".recall-traces-*")))

    def test_changed_trace_is_not_deleted(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self.fixture(tmp)
            original_digest = hashlib.sha256(path.read_bytes()).hexdigest()

            calls = 0

            def mutate_on_verification(_stream):
                nonlocal calls
                calls += 1
                if calls == 2:
                    path.write_text("new live trace")
                return original_digest

            with patch("compact_reports.digest", side_effect=mutate_on_verification):
                with self.assertRaisesRegex(ValueError, "changed during"):
                    compact_trace(path)
            self.assertEqual(path.read_text(), "new live trace")
            self.assertFalse(path.with_suffix(".json.gz").exists())
            self.assertFalse(list(Path(tmp).glob(".recall-traces-*")))

    def test_publish_failure_preserves_source_and_cleans_temporary_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self.fixture(tmp)
            original = path.read_bytes()
            with patch(
                "compact_reports.os.link", side_effect=OSError("publish failed")
            ):
                with self.assertRaisesRegex(OSError, "publish failed"):
                    compact_trace(path)
            self.assertEqual(path.read_bytes(), original)
            self.assertFalse(path.with_suffix(".json.gz").exists())
            self.assertFalse(list(Path(tmp).glob(".recall-traces-*")))

    def test_delete_failure_preserves_both_verified_copies(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self.fixture(tmp)
            original = path.read_bytes()
            unlink = Path.unlink

            def fail_source_delete(candidate, *args, **kwargs):
                if candidate == path:
                    raise PermissionError("delete failed")
                return unlink(candidate, *args, **kwargs)

            with patch.object(Path, "unlink", fail_source_delete):
                with self.assertRaisesRegex(PermissionError, "delete failed"):
                    compact_trace(path)
            self.assertEqual(path.read_bytes(), original)
            self.assertEqual(
                gzip.decompress(path.with_suffix(".json.gz").read_bytes()), original
            )
            self.assertFalse(list(Path(tmp).glob(".recall-traces-*")))


if __name__ == "__main__":
    unittest.main()
