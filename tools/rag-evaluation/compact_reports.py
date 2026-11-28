"""Losslessly compact completed recall traces; preview unless --apply is given."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import shutil
import tempfile
from pathlib import Path


def digest(stream) -> str:
    return hashlib.file_digest(stream, "sha256").hexdigest()


def completed_trace(path: Path) -> bool:
    if path.name != "recall-traces.json" or path.is_symlink():
        return False
    status = path.parent / "run-status.json"
    if not status.is_file():
        return False
    return json.loads(status.read_text()).get("status") == "completed"


def compact_trace(path: Path) -> dict:
    if not completed_trace(path):
        raise ValueError("only completed recall traces can be compacted")
    target = path.with_suffix(".json.gz")
    if target.exists():
        raise FileExistsError(target)
    before = path.stat()
    handle, filename = tempfile.mkstemp(prefix=".recall-traces-", dir=path.parent)
    temporary = Path(filename)
    os.close(handle)
    try:
        with path.open("rb") as source:
            original_digest = digest(source)
            source.seek(0)
            with gzip.open(temporary, "wb", compresslevel=6) as compressed:
                shutil.copyfileobj(source, compressed, length=1024 * 1024)
        with gzip.open(temporary, "rb") as restored:
            if digest(restored) != original_digest:
                raise ValueError("compressed trace checksum mismatch")
        current = path.stat()
        if (before.st_ino, before.st_size, before.st_mtime_ns) != (
            current.st_ino,
            current.st_size,
            current.st_mtime_ns,
        ):
            raise ValueError("trace changed during compaction")
        # Publish without overwriting a prior archive. If deletion fails, both
        # files remain recoverable and the next run reports the conflict.
        os.link(temporary, target)
        path.unlink()
        return {
            "path": str(target),
            "sha256_uncompressed": original_digest,
            "before_bytes": before.st_size,
            "after_bytes": target.stat().st_size,
        }
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reports", type=Path, default=Path("reports"))
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    paths = sorted(
        p for p in args.reports.rglob("recall-traces.json") if completed_trace(p)
    )
    rows = (
        [compact_trace(p) for p in paths]
        if args.apply
        else [{"path": str(p), "before_bytes": p.stat().st_size} for p in paths]
    )
    print(json.dumps({"applied": args.apply, "files": rows}, indent=2))


if __name__ == "__main__":
    main()
