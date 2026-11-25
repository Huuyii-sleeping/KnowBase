import tempfile
import unittest
from pathlib import Path

from snapshot_runtime import model_files, snapshot


class RuntimeSnapshotTests(unittest.TestCase):
    def test_snapshots_weights_and_config_without_host_paths_or_mutable_cache(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "model.onnx").write_bytes(b"weights")
            (root / "config.json").write_text("{}")
            (root / ".cache").mkdir()
            (root / ".cache/token.json").write_text("ignored")
            first = snapshot(root)
            self.assertEqual(len(first["models"]), 2)
            self.assertEqual(first["sha256"], snapshot(root)["sha256"])
            self.assertNotIn(tmp, str(first))
            (root / "model.onnx").write_bytes(b"different")
            self.assertNotEqual(first["sha256"], snapshot(root)["sha256"])

    def test_missing_weights_and_symlinks_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with self.assertRaises(ValueError):
                model_files(root)
            (root / "weights.onnx").write_bytes(b"weights")
            (root / "link.onnx").symlink_to(root / "weights.onnx")
            with self.assertRaises(ValueError):
                model_files(root)


if __name__ == "__main__":
    unittest.main()
