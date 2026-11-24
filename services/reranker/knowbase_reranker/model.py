"""Local, pinned Transformers cross-encoder adapter; no labels or retrieval."""

import time
import hashlib
from pathlib import Path

from .batching import length_batches
from .windows import aggregate_scores, pair_windows


class CrossEncoder:
    def __init__(self, model_config, input_config, model_root):
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        self.torch = torch
        self.config = input_config
        precision = model_config.get("precision", "float32")
        if precision not in ("float32", "float16"):
            raise ValueError("unsupported model precision")
        snapshot = Path(model_root) / model_config["id"]
        for file, expected in model_config["files_sha256"].items():
            with (snapshot / file).open("rb") as handle:
                actual = hashlib.file_digest(handle, "sha256").hexdigest()
            if actual != expected:
                raise ValueError(f"model file fingerprint differs: {file}")
        self.device = "mps" if torch.backends.mps.is_available() else "cpu"
        torch.manual_seed(0)
        torch.set_num_threads(4)
        self.tokenizer = AutoTokenizer.from_pretrained(
            snapshot,
            local_files_only=True,
            trust_remote_code=False,
        )
        self.model = AutoModelForSequenceClassification.from_pretrained(
            snapshot,
            local_files_only=True,
            trust_remote_code=False,
            use_safetensors=True,
            torch_dtype=getattr(torch, precision),
            attn_implementation="eager",
        ).to(self.device)
        self.model.eval()
        if self.model.config.num_labels != 1:
            raise ValueError("expected a single relevance logit")

    def synchronize(self):
        if self.device == "mps":
            self.torch.mps.synchronize()

    def score(self, query, candidates):
        self.synchronize()
        started = time.perf_counter()
        windows = []
        diagnostics = []
        for candidate in candidates:
            features, stats = pair_windows(
                self.tokenizer,
                query,
                candidate["title"],
                candidate.get("content") or "",
                self.config,
            )
            if len(windows) + len(features) > 512:
                raise ValueError("request exceeds model window budget")
            windows.extend(features)
            diagnostics.append(stats)
        scores = [None] * len(windows)
        with self.torch.inference_mode():
            for indices in length_batches(windows, self.config["batch_size"]):
                inputs = self.tokenizer.pad(
                    [windows[i] for i in indices],
                    padding=True,
                    return_tensors="pt",
                ).to(self.device)
                logits = self.model(**inputs).logits.reshape(-1)
                values = logits.detach().cpu().tolist()
                if len(values) != len(indices):
                    raise ValueError("incomplete model batch scores")
                # Group only for computation; aggregation still follows original windows.
                for index, value in zip(indices, values):
                    scores[index] = value
        self.synchronize()
        return {
            "scores": aggregate_scores(scores, [d["windows"] for d in diagnostics]),
            "diagnostics": diagnostics,
            "elapsed_ms": (time.perf_counter() - started) * 1000,
        }
