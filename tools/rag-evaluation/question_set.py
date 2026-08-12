from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ir_measures import Qrel


def load_questions(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list) or not payload:
        raise ValueError("question set must be a non-empty JSON array")
    for item in payload:
        if not item.get("id") or not item.get("question"):
            raise ValueError("every question must contain id and question")
    return payload


def gold_documents(question: dict[str, Any]) -> list[str]:
    values = question.get("gold_docs", question.get("gold_doc"))
    if isinstance(values, str):
        return [values]
    return [str(value) for value in values or [] if value]


def document_lookup(documents: list[dict[str, Any]]) -> dict[str, str]:
    lookup: dict[str, str] = {}
    for document in documents:
        document_id = str(document.get("id", ""))
        file_name = str(document.get("fileName", ""))
        title = str(document.get("title", ""))
        if document_id and file_name:
            lookup[file_name] = document_id
        if document_id and title:
            lookup[title] = document_id
    return lookup


def resolve_qrels(
    questions: list[dict[str, Any]], lookup: dict[str, str]
) -> tuple[list[Qrel], dict[str, list[str]]]:
    qrels: list[Qrel] = []
    resolved: dict[str, list[str]] = {}
    missing: list[str] = []
    for question in questions:
        query_id = str(question["id"])
        ids: list[str] = []
        for gold_doc in gold_documents(question):
            document_id = lookup.get(gold_doc)
            if document_id:
                ids.append(document_id)
                qrels.append(Qrel(query_id, document_id, 1))
            else:
                missing.append(gold_doc)
        resolved[query_id] = ids
    if missing:
        raise ValueError(
            "gold documents are not published in KnowBase: "
            + ", ".join(sorted(set(missing)))
        )
    return qrels, resolved
