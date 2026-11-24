import contextlib
import hashlib
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from knowbase_reranker.model import CrossEncoder


class ModelTests(unittest.TestCase):
    def test_loader_rejects_changed_weights_and_never_executes_remote_code(self):
        torch = SimpleNamespace(
            backends=SimpleNamespace(mps=SimpleNamespace(is_available=lambda: False)),
            manual_seed=MagicMock(),
            set_num_threads=MagicMock(),
            float16=object(),
        )
        model = MagicMock()
        model.to.return_value = model
        model.config.num_labels = 1
        tokenizer, loader = MagicMock(), MagicMock()
        loader.from_pretrained.return_value = model
        dependencies = {
            "torch": torch,
            "transformers": SimpleNamespace(
                AutoTokenizer=tokenizer,
                AutoModelForSequenceClassification=loader,
            ),
        }
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            sys.modules, dependencies
        ):
            root = Path(directory)
            snapshot = root / "bge-m3"
            snapshot.mkdir()
            file = snapshot / "model.safetensors"
            file.write_bytes(b"weights")
            config = {
                "id": "bge-m3",
                "precision": "float16",
                "files_sha256": {
                    "model.safetensors": hashlib.sha256(b"weights").hexdigest(),
                },
            }
            provider = CrossEncoder(config, {"batch_size": 8}, root)
            self.assertEqual(provider.device, "cpu")
            loader.from_pretrained.assert_called_once_with(
                snapshot,
                local_files_only=True,
                trust_remote_code=False,
                use_safetensors=True,
                torch_dtype=torch.float16,
                attn_implementation="eager",
            )
            loader.from_pretrained.reset_mock()
            file.write_bytes(b"changed")
            with self.assertRaisesRegex(ValueError, "fingerprint"):
                CrossEncoder(config, {}, root)
            loader.from_pretrained.assert_not_called()
            with self.assertRaisesRegex(ValueError, "precision"):
                CrossEncoder({**config, "precision": "invalid"}, {}, root)

    def provider(self):
        provider = object.__new__(CrossEncoder)
        provider.device = "cpu"
        provider.config = {"batch_size": 2}
        provider.torch = SimpleNamespace(inference_mode=contextlib.nullcontext)
        provider.tokenizer = MagicMock()
        provider.tokenizer.pad.return_value.to.return_value = {"input_ids": []}
        provider.model = MagicMock()
        return provider

    def test_scores_all_windows_then_returns_one_maximum_per_original_candidate(self):
        provider = self.provider()
        values = provider.model.return_value.logits.reshape.return_value
        values.detach.return_value.cpu.return_value.tolist.side_effect = [[7, 3], [1]]
        with patch(
            "knowbase_reranker.model.pair_windows",
            side_effect=[
                ([{"input_ids": [1] * 10}, {"input_ids": [2] * 2}], {"windows": 2}),
                ([{"input_ids": [3] * 5}], {"windows": 1}),
            ],
        ):
            result = provider.score(
                "q", [{"title": "t", "content": "body"}, {"title": "t"}]
            )
        self.assertEqual(result["scores"], [7, 3])
        self.assertEqual(provider.model.call_count, 2)
        batches = [call.args[0] for call in provider.tokenizer.pad.call_args_list]
        self.assertEqual(
            [[w["input_ids"][0] for w in batch] for batch in batches], [[2, 3], [1]]
        )

    def test_bad_batch_scores_fail_completely_and_next_request_recovers(self):
        for bad_scores in [[], [1, 2], [float("nan")], [float("inf")]]:
            with self.subTest(scores=bad_scores):
                provider = self.provider()
                values = provider.model.return_value.logits.reshape.return_value
                values.detach.return_value.cpu.return_value.tolist.side_effect = [
                    [7, 3], bad_scores, [7, 3], [1]
                ]
                with patch(
                    "knowbase_reranker.model.pair_windows",
                    return_value=(
                        [{"input_ids": [1] * n} for n in [10, 2, 5]],
                        {"windows": 3},
                    ),
                ):
                    with self.assertRaises(ValueError):
                        provider.score("q", [{"title": "t", "content": "body"}])
                    result = provider.score("q", [{"title": "t", "content": "body"}])
                self.assertEqual(result["scores"], [7])

    def test_request_window_cap_and_model_failures_never_return_partial_scores(self):
        provider = self.provider()
        with patch(
            "knowbase_reranker.model.pair_windows",
            return_value=([{}] * 513, {"windows": 513}),
        ):
            with self.assertRaisesRegex(ValueError, "window budget"):
                provider.score("q", [{"title": "t"}])
        provider.model.assert_not_called()
        provider.model.side_effect = RuntimeError("inference failed")
        with patch(
            "knowbase_reranker.model.pair_windows",
            return_value=([{"input_ids": [1]}], {"windows": 1}),
        ):
            with self.assertRaisesRegex(RuntimeError, "inference failed"):
                provider.score("q", [{"title": "t"}])


if __name__ == "__main__":
    unittest.main()
