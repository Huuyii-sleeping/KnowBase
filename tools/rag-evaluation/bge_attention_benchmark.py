"""Serial paired eager/SDPA experiment on frozen whole-body BGE smoke inputs."""

import argparse
import copy
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services/reranker"))
from knowbase_reranker.model import CrossEncoder


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--protocol", type=Path, required=True)
    parser.add_argument("--model-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    read = lambda p: json.loads(Path(p).read_text())
    protocol = read(args.protocol)
    for file, expected in protocol["files_sha256"].items():
        if hashlib.sha256((ROOT / file).read_bytes()).hexdigest() != expected:
            raise ValueError("fingerprint differs: " + file)
    manifest = read(ROOT / "services/reranker/knowbase_reranker/manifest.json")
    source = read(ROOT / protocol["replay"])
    parent = read(ROOT / protocol["model_protocol"])
    model = CrossEncoder(manifest["model"], manifest["model_input"], args.model_root)
    from transformers import AutoModelForSequenceClassification

    sdpa = copy.copy(model)
    sdpa.model = AutoModelForSequenceClassification.from_pretrained(
        args.model_root / manifest["model"]["id"],
        local_files_only=True,
        trust_remote_code=False,
        use_safetensors=True,
        torch_dtype=model.torch.float16,
        attn_implementation="sdpa",
    ).to(model.device)
    sdpa.model.eval()
    providers = {"eager": model, "sdpa": sdpa}
    classes = {
        k: type(v.model.roberta.encoder.layer[0].attention.self).__name__
        for k, v in providers.items()
    }
    if classes != {
        "eager": "XLMRobertaSelfAttention",
        "sdpa": "XLMRobertaSdpaSelfAttention",
    }:
        raise ValueError("attention kernel was not actually changed: " + str(classes))
    rows = []
    for case_index, case in enumerate(protocol["cases"]):
        row = next(
            r
            for s in source["sources"]
            if s["id"] == case["source"]
            for r in s["rows"]
            if r["id"] == case["id"]
        )
        query = parent["queries"][case["source"]][case["id"]]
        variants = {}
        # Alternate execution order to reduce systematic warm-up/thermal bias.
        order = ["eager", "sdpa"] if case_index % 2 == 0 else ["sdpa", "eager"]
        for implementation in order:
            provider = providers[implementation]
            provider.score("warmup", [{"title": "warmup", "content": "warmup"}])
            variants[implementation] = provider.score(query, row["pool"])
        result = {**case, "variants": variants}
        rows.append(result)
        print(
            json.dumps(
                {
                    **case,
                    "completed": len(rows),
                    "times": {k: round(v["elapsed_ms"]) for k, v in variants.items()},
                }
            ),
            flush=True,
        )
    with args.output.open("x") as handle:
        json.dump(
            {
                "complete": True,
                "device": model.device,
                "attention_classes": classes,
                "rows": rows,
                "protocol_sha256": hashlib.sha256(
                    json.dumps(
                        protocol, ensure_ascii=False, separators=(",", ":")
                    ).encode()
                ).hexdigest(),
            },
            handle,
        )
        handle.write("\n")


if __name__ == "__main__":
    main()
