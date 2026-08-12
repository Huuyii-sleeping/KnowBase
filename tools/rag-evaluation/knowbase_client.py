from __future__ import annotations

import time
from typing import Any, Callable

import requests


class KnowBaseClient:
    def __init__(
        self,
        base_url: str,
        timeout_seconds: float,
        request_get: Callable[..., requests.Response] = requests.get,
        request_post: Callable[..., requests.Response] = requests.post,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.request_get = request_get
        self.request_post = request_post

    def list_documents(self) -> list[dict[str, Any]]:
        response = self.request_get(
            f"{self.base_url}/documents",
            params={"page": 1, "pageSize": 100},
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        return list(response.json().get("items", []))

    def search(
        self, query: str, top_k: int, mode: str
    ) -> tuple[list[dict[str, Any]], float]:
        started = time.perf_counter()
        path = "/search/semantic" if mode == "semantic" else "/search/hybrid"
        response = self.request_post(
            f"{self.base_url}{path}",
            json={"query": query, "topK": top_k},
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        return list(response.json().get("items", [])), round(
            (time.perf_counter() - started) * 1000, 2
        )
