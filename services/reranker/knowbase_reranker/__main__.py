"""Start the pinned model runtime after checksum verification and health warmup."""

import argparse
import importlib.metadata
import json
from pathlib import Path

from .model import CrossEncoder
from .server import RerankServer


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-root", type=Path, required=True)
    parser.add_argument("--port", type=int, default=18081)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("port must be 1..65535")
    manifest = json.loads(Path(__file__).with_name("manifest.json").read_text())
    for package, expected in manifest["runtime"].items():
        if importlib.metadata.version(package) != expected:
            raise ValueError("runtime dependency version differs: " + package)
    model = CrossEncoder(manifest["model"], manifest["model_input"], args.model_root)
    model.score("What is the color?", [{"title": "Health", "content": "Blue."}])
    # The API and model run on the same host; no unauthenticated public listener.
    server = RerankServer(("127.0.0.1", args.port), model)
    print(
        json.dumps({"ready": True, "port": args.port, "device": model.device}),
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
