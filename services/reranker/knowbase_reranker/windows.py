"""Bounded input windows. Initial behavior matches frozen rerank-v2 FP16.

The benchmark copy is archived to preserve its committed fingerprints.
Runtime changes must be checked against that frozen evaluation, not edited there.
"""

import hashlib
import json
import math


def fingerprint(value):
    return hashlib.sha256(
        json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
    ).hexdigest()


def pair_key(query, candidate):
    return fingerprint([query, candidate["title"], candidate.get("content") or ""])


def pair_windows(tokenizer, query, title, content, config):
    if not isinstance(query, str) or not query.strip():
        raise ValueError("query must be nonempty text")
    if not isinstance(title, str) or not isinstance(content, str):
        raise ValueError("title and content must be text")
    query_ids = tokenizer.encode(query, add_special_tokens=False)
    title_ids = tokenizer.encode(title + "\n", add_special_tokens=False)
    body_ids = tokenizer.encode(content, add_special_tokens=False)
    query_limit = config["query_tokens"]
    title_limit = config["title_tokens"]
    if query_limit < 1 or title_limit < 1:
        raise ValueError("query and title limits must be positive")
    query_part = query_ids[:query_limit]
    title_part = title_ids[:title_limit]
    capacity = (
        config["max_length"]
        - len(query_part)
        - len(title_part)
        - tokenizer.num_special_tokens_to_add(pair=True)
    )
    overlap = config["overlap_tokens"]
    if overlap < 0 or capacity <= overlap:
        raise ValueError("window overlap must be smaller than passage capacity")
    windows = []
    start = 0
    while True:
        end = min(start + capacity, len(body_ids))
        passage = title_part + body_ids[start:end]
        ids = tokenizer.build_inputs_with_special_tokens(query_part, passage)
        item = {"input_ids": ids, "attention_mask": [1] * len(ids)}
        if "token_type_ids" in tokenizer.model_input_names:
            item["token_type_ids"] = tokenizer.create_token_type_ids_from_sequences(
                query_part, passage
            )
        windows.append(item)
        if end == len(body_ids):
            break
        start = end - overlap
    return windows, {
        "body_tokens": len(body_ids),
        "windows": len(windows),
        "query_tokens_dropped": max(0, len(query_ids) - query_limit),
        "title_tokens_dropped": max(0, len(title_ids) - title_limit),
    }


def aggregate_scores(scores, counts):
    if any(not isinstance(n, int) or n < 1 for n in counts):
        raise ValueError("each candidate needs at least one window")
    if sum(counts) != len(scores) or any(not math.isfinite(s) for s in scores):
        raise ValueError("nonfinite or incomplete model scores")
    offset = 0
    result = []
    for count in counts:
        result.append(max(scores[offset : offset + count]))
        offset += count
    return result
