from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from ir_measures import Qrel


def load_questions(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list) or not payload:
        raise ValueError("question set must be a non-empty JSON array")
    ids = set()
    for item in payload:
        if (
            not isinstance(item, dict)
            or not isinstance(item.get("id"), str)
            or not isinstance(item.get("question"), str)
            or not item["id"].strip()
            or not item["question"].strip()
        ):
            raise ValueError("every question must contain id and question")
        if item["id"] in ids:
            raise ValueError(f"duplicate question id: {item['id']}")
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", item["id"]):
            raise ValueError("question ids must be safe identifiers for TREC output")
        if "category" in item and (
            not isinstance(item["category"], str) or not item["category"].strip()
        ):
            raise ValueError("question category must be a non-empty string")
        ids.add(item["id"])
        case_type = item.get("type", "answerable")
        if case_type not in {"answerable", "unanswerable"}:
            raise ValueError(f"invalid question type: {case_type}")
        gold = gold_documents(item)
        if bool(gold) != (case_type == "answerable"):
            raise ValueError(
                f"{item['id']}: answerable cases need gold documents; unanswerable cases must have none"
            )
        evidence = item.get("evidence", [])
        if not isinstance(evidence, list):
            raise ValueError(f"{item['id']}: evidence must be an array")
        for entry in evidence:
            if (
                not isinstance(entry, dict)
                or entry.get("doc") not in gold
                or not isinstance(entry.get("quote"), str)
                or not entry["quote"].strip()
            ):
                raise ValueError(
                    f"{item['id']}: evidence requires a gold document and non-empty quote"
                )
    return payload


def gold_documents(question: dict[str, Any]) -> list[str]:
    values = question.get("gold_docs", question.get("gold_doc"))
    if isinstance(values, str):
        if not values.strip():
            raise ValueError("gold document names must not be empty")
        return [values]
    if not isinstance(values, list) or any(
        not isinstance(value, str) or not value.strip() for value in values
    ):
        raise ValueError(
            "gold documents must be a string or an array of non-empty strings"
        )
    if len(set(values)) != len(values):
        raise ValueError("gold documents must be unique")
    return values


def document_lookup(documents: list[dict[str, Any]]) -> dict[str, str]:
    lookup: dict[str, str] = {}
    for document in documents:
        if document.get("status") not in {None, "PUBLISHED"}:
            continue
        document_id = str(document.get("id", ""))
        file_name = str(document.get("fileName", ""))
        title = str(document.get("title", ""))
        for key in (file_name, title):
            if document_id and key:
                if key in lookup and lookup[key] != document_id:
                    raise ValueError(f"ambiguous published document name: {key}")
                lookup[key] = document_id
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
