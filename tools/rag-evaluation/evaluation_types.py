from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class EvaluationConfig:
    base_url: str
    questions_path: Path
    output_dir: Path
    top_k: int
    mode: str
    timeout_seconds: float
    username: str | None = None
    password: str | None = None
    access_token: str | None = None
