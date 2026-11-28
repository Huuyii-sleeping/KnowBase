import contextlib
import hashlib
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools/rag-evaluation"))
from rerank_model_provider import CrossEncoder


class ProviderTests(unittest.TestCase):
    def dependencies(self):
        torch = SimpleNamespace(
            backends=SimpleNamespace(mps=SimpleNamespace(is_available=lambda: True)),
            manual_seed=MagicMock(),
            set_num_threads=MagicMock(),
            float16=object(),
        )
        tokenizer = SimpleNamespace(from_pretrained=MagicMock())
        model = MagicMock()
        model.to.return_value = model
        model.config.num_labels = 1
        loader = SimpleNamespace(from_pretrained=MagicMock(return_value=model))
        modules = {
            "torch": torch,
            "transformers": SimpleNamespace(
                AutoTokenizer=tokenizer, AutoModelForSequenceClassification=loader
            ),
        }
        return modules, torch, tokenizer, loader, model

    def config(self, root):
        snapshot = root / "model"
        snapshot.mkdir()
        (snapshot / "model.safetensors").write_bytes(b"fixture")
        return {
            "id": "model",
            "precision": "float16",
            "files_sha256": {
                "model.safetensors": hashlib.sha256(b"fixture").hexdigest()
            },
        }

    def test_constructor_pins_local_safe_loader_and_precision(self):
        modules, torch, tokenizer, loader, model = self.dependencies()
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            sys.modules, modules
        ):
            root = Path(directory)
            provider = CrossEncoder(self.config(root), {"batch_size": 8}, root)
            self.assertEqual(provider.device, "mps")
            tokenizer.from_pretrained.assert_called_once_with(
                root / "model", local_files_only=True, trust_remote_code=False
            )
            loader.from_pretrained.assert_called_once_with(
                root / "model",
                local_files_only=True,
                trust_remote_code=False,
                use_safetensors=True,
                torch_dtype=torch.float16,
                attn_implementation="eager",
            )
            model.to.assert_called_once_with("mps")
            model.eval.assert_called_once()
            torch.manual_seed.assert_called_once_with(0)
            torch.set_num_threads.assert_called_once_with(4)

    def test_invalid_precision_or_changed_weights_stop_before_loading(self):
        modules, _, tokenizer, loader, model = self.dependencies()
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            sys.modules, modules
        ):
            root = Path(directory)
            config = self.config(root)
            with self.assertRaisesRegex(ValueError, "precision"):
                CrossEncoder({**config, "precision": "unknown"}, {}, root)
            (root / "model/model.safetensors").write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "fingerprint"):
                CrossEncoder(config, {}, root)
            tokenizer.from_pretrained.assert_not_called()
            loader.from_pretrained.assert_not_called()
            (root / "model/model.safetensors").write_bytes(b"fixture")
            model.config.num_labels = 2
            with self.assertRaisesRegex(ValueError, "single relevance logit"):
                CrossEncoder(config, {}, root)

    def test_inference_batches_windows_aggregates_and_propagates_failure(self):
        provider = object.__new__(CrossEncoder)
        sync = MagicMock()
        provider.torch = SimpleNamespace(
            inference_mode=contextlib.nullcontext,
            mps=SimpleNamespace(synchronize=sync),
        )
        provider.device = "mps"
        provider.config = {"batch_size": 2}
        provider.tokenizer = MagicMock()
        provider.tokenizer.pad.return_value.to.return_value = {"input_ids": [1]}
        provider.model = MagicMock()
        values = provider.model.return_value.logits.reshape.return_value
        values.detach.return_value.cpu.return_value.tolist.side_effect = [[1, 9], [3]]
        features = [([{}, {}], {"windows": 2}), ([{}], {"windows": 1})]
        candidates = [{"title": "a", "content": "body"}, {"title": "b"}]
        with patch("rerank_model_provider.pair_windows", side_effect=features):
            result = provider.score("query", candidates)
        self.assertEqual(result["scores"], [9, 3])
        self.assertEqual(result["diagnostics"], [{"windows": 2}, {"windows": 1}])
        self.assertGreaterEqual(result["elapsed_ms"], 0)
        self.assertEqual(provider.model.call_count, 2)
        self.assertEqual(sync.call_count, 2)
        provider.model.side_effect = RuntimeError("device failure")
        with patch("rerank_model_provider.pair_windows", side_effect=features):
            with self.assertRaisesRegex(RuntimeError, "device failure"):
                provider.score("query", candidates)


if __name__ == "__main__":
    unittest.main()
