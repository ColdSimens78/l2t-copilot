"""Тесты qwen_bridge: ТОЛЬКО моки (httpx.MockTransport), живой прокси не трогаем.

qwen-stack может быть выключен — сетевых вызовов из тестов нет вовсе:
transport подменяется, реальный :5000 не нужен. Проверяем контракт
(logic) и переупаковку ошибок в MCP-слое (server).
"""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from mcp_servers.qwen_bridge import logic as lg
from mcp_servers.qwen_bridge import server


def _ok(body: dict, status: int = 200) -> httpx.Response:
    return httpx.Response(status, json=body)


def test_chat_success():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["method"] = request.method
        seen["path"] = request.url.path
        seen["session"] = request.headers.get("x-session-id")
        seen["persona"] = request.headers.get("x-persona")
        seen["body"] = json.loads(request.content)
        return _ok({"choices": [{"message": {"role": "assistant",
                                             "content": "Привет из qwen"}}]})

    res = lg.chat("какой bpm?", session="l2t", persona="Producer",
                  transport=httpx.MockTransport(handler))
    assert seen["method"] == "POST"
    assert seen["path"] == "/v1/chat/completions"
    assert seen["session"] == "l2t"
    assert seen["persona"] == "producer"  # нормализация прокси: strip+lower
    assert seen["body"]["messages"] == [{"role": "user", "content": "какой bpm?"}]
    assert seen["body"]["max_tokens"] == 1024
    assert seen["body"]["stream"] is False
    assert res == {"text": "Привет из qwen", "session": "l2t",
                   "persona": "Producer"}


def test_chat_auth_header_from_env(monkeypatch):
    got: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        got.append(request.headers.get("authorization", ""))
        return _ok({"choices": [{"message": {"content": "ok"}}]})

    monkeypatch.delenv("PROXY_API_KEY", raising=False)
    lg.chat("hi", transport=httpx.MockTransport(handler))
    assert got[-1] == ""  # без ключа заголовка нет (локальный режим прокси)

    monkeypatch.setenv("PROXY_API_KEY", "s3cret")
    lg.chat("hi", transport=httpx.MockTransport(handler))
    assert got[-1] == "Bearer s3cret"  # сверено с _check в memory_proxy.py


def test_chat_connection_error_is_bounded():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("Connection refused")

    with pytest.raises(lg.ProxyError) as info:
        lg.chat("hi", transport=httpx.MockTransport(handler))
    assert "недоступен" in str(info.value)  # внятный текст, не зависание

    # MCP-слой переупаковывает так, чтобы текст дошёл до модели (правило №3);
    # в SDK 2.x это ToolError, в 1.x — исходное исключение: проверяем текст.
    with pytest.raises(Exception) as mcp_info:
        server.chat("hi")
    assert "недоступен" in str(mcp_info.value)


def test_chat_404_persona_text_passthrough():
    def handler(request: httpx.Request) -> httpx.Response:
        return _ok({"detail": "Персона не найдена: ghost"}, status=404)

    with pytest.raises(lg.ProxyError) as info:
        lg.chat("hi", persona="ghost", transport=httpx.MockTransport(handler))
    msg = str(info.value)
    assert "404" in msg and "Персона не найдена: ghost" in msg


def test_memory_search_format():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["params"] = dict(request.url.params)
        return _ok({"query": "бpm", "hits": [["l2t", "user", "бpm 60"],
                                             ["other", "assistant", "не то"]]})

    res = lg.memory_search("бpm", session="l2t",
                           transport=httpx.MockTransport(handler))
    assert seen["params"] == {"q": "бpm", "session": "l2t"}
    assert res["count"] == 2
    # прокси отдаёт hits массивами [session, role, content] — разворачиваем в dict
    assert res["hits"][0] == {"session": "l2t", "role": "user", "content": "бpm 60"}
    assert res["hits"][1]["session"] == "other"


def test_forget():
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["method"] = request.method
        seen["path"] = request.url.path
        return _ok({"cleared": "l2t"})

    res = lg.forget("l2t", transport=httpx.MockTransport(handler))
    assert seen["method"] == "DELETE"
    assert seen["path"] == "/v1/memory/l2t"
    assert res == {"cleared": "l2t"}


def test_personas():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET" and request.url.path == "/v1/personas"
        return _ok({"personas": ["default", "producer"]})

    res = lg.personas(transport=httpx.MockTransport(handler))
    assert res == {"personas": ["default", "producer"]}


def test_vision_analyze():
    seen: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content))
        return _ok({"description": "DAW открыта, 4 трека",
                    "source": "screen", "path": None})

    res = lg.vision_analyze(transport=httpx.MockTransport(handler))
    assert seen[-1] == {"source": "screen"}
    assert res["description"] == "DAW открыта, 4 трека"

    res = lg.vision_analyze("image", "/tmp/shot.png",
                            transport=httpx.MockTransport(handler))
    assert seen[-1] == {"source": "image", "path": "/tmp/shot.png"}

    with pytest.raises(ValueError):  # ранневалидация без похода в сеть
        lg.vision_analyze("image")
    with pytest.raises(ValueError):
        lg.vision_analyze("camera")


def test_server_registers_brain_tools():
    tools = asyncio.run(server.mcp.list_tools())
    names = sorted(t.name for t in tools)
    assert names == ["brain.chat", "brain.forget", "brain.memory_search",
                     "brain.personas", "brain.vision_analyze"]


def test_main_usage_exit(capsys):
    with pytest.raises(SystemExit) as info:
        server.main(["oops"])
    assert info.value.code == 2  # урок Wave 2: usage-ошибка вместо тихого stdin
    assert "usage" in capsys.readouterr().err
