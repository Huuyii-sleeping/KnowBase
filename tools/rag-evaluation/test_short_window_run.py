import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import rerank_short_window_run as runner


class ShortWindowRunTests(unittest.TestCase):
    def test_protocol_or_metadata_changes_fail_before_model_load(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "model.json").write_text(json.dumps({"runtime": {}, "models": [{"id": "bge-m3"}]}))
            protocol = {"files_sha256": {}, "model_protocol": "model.json", "expected_pools": 1, "short_input": {"max_length": 256}}
            output = root / "output"
            output.mkdir()
            (output / "metadata.json").write_text('{}')
            with patch.object(runner, "ROOT", root), patch.object(runner, "load_inputs", return_value=[{}]), patch.object(runner, "CrossEncoder") as factory:
                with self.assertRaisesRegex(ValueError, "metadata differs"):
                    runner.run(protocol, root, output)
                factory.assert_not_called()
            with patch.object(runner, "ROOT", root), patch.object(runner, "load_inputs", return_value=[]), patch.object(runner, "CrossEncoder") as factory:
                with self.assertRaisesRegex(ValueError, "pool count"):
                    runner.run(protocol, root, output)
                factory.assert_not_called()


if __name__ == "__main__":
    unittest.main()
