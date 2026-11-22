"""Чистые HTTP-вызовы к qwen-stack memory_proxy — без MCP.

Контракт сверен с qwen-stack-repo/memory_proxy.py:

- auth: если задан PROXY_API_KEY (только из окружения — никаких хардкодов),
  шлём ``Authorization: Bearer <key>`` (см. ``_check`` в прокси; пустой
  ключ = локальный режим без auth);
- память диалогов подставляется прокси по заголовкам ``X-Session-Id``
  (default "default") и ``X-Persona`` (persona_<id>.py рядом с прокси);
- все вызовы bounded (timeout 60 c, правила шины №2/№3): прокси недоступен
  или ответил ошибкой -> ``ProxyError`` с внятным текстом, никаких зависаний.

Для тестов каждая функция принимает ``transport=`` (httpx.MockTransport) —
живой сервер не нужен.
"""

from __future__ import annotations

import json
import os
from typing import Any

import httpx

DEFAULT_BASE_URL = "http://127.0.0.1:5000"
TIMEOUT = 60.0


class ProxyError(RuntimeError):
    """Прокси недоступен или ответил ошибкой; текст готов для isError."""


def _base_url(base_url: str | None) -> str:
    return base_url or os.environ.get("QWEN_BASE_URL", DEFAULT_BASE_URL)


def _auth_headers() -> dict[str, str]:
    key = os.environ.get("PROXY_API_KEY", "").strip()
    return {"Authorization": f"Bearer {key}"} if key else {}


def _request(method: str, path: str, *, base_url: str | None = None,
             params: dict[str, Any] | None = None, json_body: Any = None,
             extra_headers: dict[str, str] | None = None,
             transport: httpx.BaseTransport | None = None) -> dict:
    url = _base_url(base_url)
    headers = _auth_headers()
    if extra_headers:
        headers.update(extra_headers)
    try:
        with httpx.Client(base_url=url, timeout=TIMEOUT,
                          transport=transport) as client:
            resp = client.request(method, path, params=params, json=json_body,
                                  headers=headers)
    except httpx.HTTPError as exc:  # connect refused / timeout / DNS — bounded
        raise ProxyError(
            f"qwen-stack прокси недоступен ({url}{path}): {exc!r}. "
            "Подними memory_proxy (:5000) и повтори."
        ) from exc
    if resp.is_error:
        try:  # FastAPI кладёт причину в {"detail": ...}
            detail = resp.json().get("detail", resp.text)
        except ValueError:
            detail = resp.text
        raise ProxyError(f"прокси ответил {resp.status_code} на {method} {path}: "
                         f"{str(detail)[:300]}")
    try:
        return resp.json()
    except ValueError as exc:
        raise ProxyError(f"прокси вернул не-JSON на {method} {path}: "
                         f"{resp.text[:200]!r}") from exc


def chat(prompt: str, session: str = "default", persona: str | None = None,
         max_tokens: int = 1024, *, base_url: str | None = None,
         transport: httpx.BaseTransport | None = None) -> dict:
    """POST /v1/chat/completions: память сессии и system-промпт персоны
    подставляет прокси (по заголовкам X-Session-Id / X-Persona).

    Возвращает компактный {"text", "session", "persona"}.
    """
    headers = {"X-Session-Id": session}
    if persona:
        headers["X-Persona"] = persona.strip().lower()  # нормализация прокси
    body = {"messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_tokens, "stream": False}
    data = _request("POST", "/v1/chat/completions", json_body=body,
                    extra_headers=headers, base_url=base_url, transport=transport)
    try:
        text = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise ProxyError("неожиданный формат ответа chat/completions: "
                         + json.dumps(data, ensure_ascii=False)[:300]) from exc
    return {"text": text, "session": session, "persona": persona}


def memory_search(query: str, session: str | None = None, *,
                  base_url: str | None = None,
                  transport: httpx.BaseTransport | None = None) -> dict:
    """GET /v1/memory/search: LIKE-поиск по всем диалогам (или одной сессии).

    Прокси возвращает hits массивами [session, role, content] — разворачиваем
    в dict для читаемости. До 50 совпадений, свежие первыми.
    """
    params: dict[str, str] = {"q": query}
    if session:
        params["session"] = session
    data = _request("GET", "/v1/memory/search", params=params,
                    base_url=base_url, transport=transport)
    hits = [{"session": h[0], "role": h[1], "content": h[2]}
            for h in data.get("hits", [])]
    return {"query": query, "session": session, "count": len(hits), "hits": hits}


def forget(session: str, *, base_url: str | None = None,
           transport: httpx.BaseTransport | None = None) -> dict:
    """DELETE /v1/memory/{session}: очистить память сессии (msgs + summaries)."""
    data = _request("DELETE", f"/v1/memory/{session}",
                    base_url=base_url, transport=transport)
    return {"cleared": data.get("cleared", session)}


def personas(*, base_url: str | None = None,
             transport: httpx.BaseTransport | None = None) -> dict:
    """GET /v1/personas: id доступных персон (persona_*.py рядом с прокси)."""
    data = _request("GET", "/v1/personas", base_url=base_url, transport=transport)
    return {"personas": list(data.get("personas", []))}


def vision_analyze(source: str = "screen", path: str | None = None, *,
                   base_url: str | None = None,
                   transport: httpx.BaseTransport | None = None) -> dict:
    """POST /v1/vision/analyze: скриншот (screen) или файл (image+path) ->
    текстовое описание через vision-модель."""
    if source not in ("screen", "image"):
        raise ValueError(f"source должен быть 'screen' или 'image', получил {source!r}")
    if source == "image" and not path:
        raise ValueError("для source=image нужен path")
    body: dict[str, Any] = {"source": source}
    if path:
        body["path"] = path
    data = _request("POST", "/v1/vision/analyze", json_body=body,
                    base_url=base_url, transport=transport)
    return {"description": data.get("description", ""),
            "source": source, "path": path}
