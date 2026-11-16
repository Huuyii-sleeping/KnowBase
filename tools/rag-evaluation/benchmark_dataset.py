"""Validate the original benchmark corpus and its literal evidence annotations."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from question_set import gold_documents, load_questions


def validate_dataset(directory: Path) -> dict:
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    if not isinstance(manifest, dict):
        raise ValueError("manifest must be an object")
    documents = manifest.get("documents")
    if not manifest.get("version") or not isinstance(documents, list) or not documents:
        raise ValueError("manifest needs a version and non-empty document list")
    files = {}
    titles = set()
    for item in documents:
        if not isinstance(item, dict):
            raise ValueError("corpus document entries must be objects")
        filename = item.get("file")
        if (
            not isinstance(filename, str)
            or Path(filename).name != filename
            or not filename.endswith(".md")
        ):
            raise ValueError("corpus filenames must be Markdown basenames")
        if (
            filename in files
            or not isinstance(item.get("title"), str)
            or not item["title"].strip()
            or item["title"] in titles
        ):
            raise ValueError(
                "corpus documents need unique filenames and non-empty titles"
            )
        files[filename] = (directory / "docs" / filename).read_text(encoding="utf-8")
        titles.add(item["title"])
    questions = load_questions(directory / "questions.json")
    for question in questions:
        gold = gold_documents(question)
        evidence = question.get("evidence", [])
        if not set(gold) <= files.keys():
            raise ValueError(f"{question['id']}: missing gold document in corpus")
        if question.get("type", "answerable") == "answerable" and {
            entry["doc"] for entry in evidence
        } != set(gold):
            raise ValueError(f"{question['id']}: every gold document needs evidence")
        for entry in evidence:
            if entry["quote"] not in files[entry["doc"]]:
                raise ValueError(
                    f"{question['id']}: evidence quote does not exist verbatim"
                )
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    args = parser.parse_args()
    result = validate_dataset(args.directory)
    print(
        json.dumps(
            {"version": result["version"], "documents": len(result["documents"])},
            ensure_ascii=False,
        )
    )
