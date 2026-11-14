"""Check coverage and source separation for a declared synthetic benchmark."""

from collections import Counter
from itertools import combinations


def dataset_coverage(manifest: dict, questions: list[dict]) -> dict:
    splits = {}
    for split in sorted({q.get("split", "unspecified") for q in questions}):
        cases = [q for q in questions if q.get("split", "unspecified") == split]
        splits[split] = {
            "questions": len(cases),
            "types": dict(Counter(q.get("type", "answerable") for q in cases)),
            "categories": dict(
                Counter(q.get("category", "unspecified") for q in cases)
            ),
            "phenomena": dict(
                Counter(p for q in cases for p in q.get("phenomena", []))
            ),
            "gold_documents": sorted(
                {doc for q in cases for doc in q.get("gold_docs", [])}
            ),
            "families": sorted({q["family"] for q in cases if "family" in q}),
        }
    return {
        "documents": len(manifest["documents"]),
        "questions": len(questions),
        "splits": splits,
    }


def validate_contract(manifest: dict, questions: list[dict], contract: dict) -> dict:
    coverage = dataset_coverage(manifest, questions)
    actual = {
        split: values["questions"] for split, values in coverage["splits"].items()
    }
    if actual != contract["split_counts"]:
        raise ValueError("dataset split counts differ from frozen contract")
    if coverage["documents"] != contract["document_count"]:
        raise ValueError("dataset document count differs from frozen contract")
    if dict(Counter(q["type"] for q in questions)) != contract["type_counts"]:
        raise ValueError("dataset question type counts differ from frozen contract")
    if len({q["question"].strip() for q in questions}) != len(questions):
        raise ValueError("dataset questions must use distinct wording")
    documents = {d["file"]: d for d in manifest["documents"]}
    protected = contract["source_disjoint_splits"]
    for a, b in combinations(protected, 2):
        for key in ("gold_documents", "families"):
            if set(coverage["splits"][a][key]) & set(coverage["splits"][b][key]):
                raise ValueError(
                    f"{a}/{b}: source families and gold documents must be disjoint"
                )
    for split in protected:
        cases = [q for q in questions if q["split"] == split]
        positive = Counter(q["category"] for q in cases if q["type"] == "answerable")
        if any(
            positive[c] < contract["min_per_category"]
            for c in contract["required_positive_categories"]
        ):
            raise ValueError(f"{split}: insufficient positive category coverage")
        negative_tags = {
            p
            for q in cases
            if q["type"] == "unanswerable"
            for p in q.get("phenomena", [])
        }
        if not set(contract["required_negative_phenomena"]) <= negative_tags:
            raise ValueError(f"{split}: missing negative phenomena")
        for q in cases:
            if q.get("origin") != contract["allowed_origin"] or not q.get("family"):
                raise ValueError(
                    f"{q['id']}: missing synthetic provenance or source family"
                )
            if not q.get("phenomena"):
                raise ValueError(f"{q['id']}: missing phenomenon annotation")
            if (
                q["type"] == "unanswerable"
                and not q.get("unanswerable_reason", "").strip()
            ):
                raise ValueError(
                    f"{q['id']}: negative cases require an absent-fact explanation"
                )
            if q["category"] == "heading_context" and not q.get("section_heading"):
                raise ValueError(
                    f"{q['id']}: heading-context cases require section metadata"
                )
            for doc in q["gold_docs"]:
                if (
                    documents[doc].get("partition") != split
                    or documents[doc].get("family") != q["family"]
                ):
                    raise ValueError(
                        f"{q['id']}: gold source violates partition or family"
                    )
    return coverage
