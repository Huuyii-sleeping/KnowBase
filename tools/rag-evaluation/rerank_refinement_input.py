"""Offline BGE input ablations. No questions, evidence labels, or selection rules."""

import re

from rerank_model_input import pair_windows


def input_windows(tokenizer, query, candidate, config, mode):
    if mode == "title":
        return pair_windows(tokenizer, query, candidate["title"], candidate["content"], config)
    if mode == "sections":
        # Only headings already present in this chunk, never invented ancestors.
        headings = re.findall(r"^ {0,3}#{2,6}\s+(.+?)\s*#*\s*$", candidate["content"], re.M)
        title = "\n".join(dict.fromkeys([candidate["title"], *headings]))
        return pair_windows(tokenizer, query, title, candidate["content"], config)
    if mode != "body":
        raise ValueError("unsupported input mode")
    # Remove the additional metadata prefix, preserving the complete original body,
    # including any Markdown headings it already contains. No token round trip.
    query_ids = tokenizer.encode(query, add_special_tokens=False)
    if not query.strip():
        raise ValueError("query must be nonempty text")
    body = tokenizer.encode(candidate["content"], add_special_tokens=False)
    query_part = query_ids[:config["query_tokens"]]
    capacity = config["max_length"] - len(query_part) - tokenizer.num_special_tokens_to_add(pair=True)
    overlap = config["overlap_tokens"]
    if overlap < 0 or capacity <= overlap:
        raise ValueError("window overlap must be smaller than passage capacity")
    windows, start = [], 0
    while True:
        end = min(start + capacity, len(body))
        part = body[start:end]
        ids = tokenizer.build_inputs_with_special_tokens(query_part, part)
        item = {"input_ids": ids, "attention_mask": [1] * len(ids)}
        if "token_type_ids" in tokenizer.model_input_names:
            item["token_type_ids"] = tokenizer.create_token_type_ids_from_sequences(query_part, part)
        windows.append(item)
        if end == len(body):
            break
        start = end - overlap
    return windows, {"body_tokens": len(body), "windows": len(windows),
                     "query_tokens_dropped": max(0, len(query_ids) - config["query_tokens"]),
                     "title_tokens_dropped": 0}
