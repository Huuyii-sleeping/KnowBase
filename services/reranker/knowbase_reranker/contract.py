"""Validate the bounded HTTP contract independently of model infrastructure."""

import math

MODEL_ID = "BAAI/bge-reranker-v2-m3"
MAX_BYTES = 2 * 1024 * 1024


def validate_request(value):
    if not isinstance(value, dict):
        raise ValueError("expected object")
    request_id = value.get("requestId")
    query = value.get("query")
    candidates = value.get("candidates")
    if not isinstance(request_id, str) or not 1 <= len(request_id) <= 128:
        raise ValueError("invalid request identity")
    if not isinstance(query, str) or not query.strip() or len(query) > 2048:
        raise ValueError("invalid query")
    if not isinstance(candidates, list) or not 1 <= len(candidates) <= 120:
        raise ValueError("invalid candidate count")
    ids = set()
    for item in candidates:
        if not isinstance(item, dict):
            raise ValueError("invalid candidate")
        identifier = item.get("id")
        if (
            not isinstance(identifier, str)
            or not 1 <= len(identifier) <= 512
            or identifier in ids
        ):
            raise ValueError("invalid or duplicate candidate identity")
        ids.add(identifier)
        if not isinstance(item.get("title"), str) or len(item["title"]) > 2048:
            raise ValueError("invalid title")
        if not isinstance(item.get("content"), str) or len(item["content"]) > 20000:
            raise ValueError("invalid content")
    return request_id, query, candidates


def serialize_scores(request_id, candidates, result):
    scores = result["scores"]
    if len(scores) != len(candidates) or any(
        not isinstance(score, (int, float))
        or isinstance(score, bool)
        or not math.isfinite(score)
        for score in scores
    ):
        raise ValueError("invalid model output")
    return {
        "requestId": request_id,
        "model": MODEL_ID,
        "scores": [
            {"id": item["id"], "score": score}
            for item, score in zip(candidates, scores)
        ],
    }
