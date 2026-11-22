#!/usr/bin/env python3
"""Мок MCP-сервер для тестов l2t-core: минимальный JSON-RPC over stdio.

Инструменты:
  echo_ok      — мгновенно отвечает {"ok": true}
  fail_tool    — отвечает isError с текстом "busted by mock"
  sleep_forever — НЕ отвечает (спит) — сценарий «таймаут ≠ отказ»:
                 сервер жив, tools/list продолжает отвечать, чтобы
                 авто-инспект ядра получил Some(true)

Чтение — построчно; долгие вызовы уходят в поток, reader живёт.
"""

import json
import sys
import threading
import time


def send(msg: dict) -> None:
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def tool_result(req_id, text: str, is_error: bool = False) -> None:
    send({
        "jsonrpc": "2.0", "id": req_id,
        "result": {
            "content": [{"type": "text", "text": text}],
            "isError": is_error,
        },
    })


def handle(line: str) -> None:
    msg = json.loads(line)
    method = msg.get("method", "")
    req_id = msg.get("id")
    if method == "initialize":
        send({"jsonrpc": "2.0", "id": req_id, "result": {
            "protocolVersion": "2024-11-05",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "mock-sleepy", "version": "0"},
        }})
    elif method == "tools/list":
        send({"jsonrpc": "2.0", "id": req_id, "result": {"tools": [
            {"name": "echo_ok", "description": "instant ok",
             "inputSchema": {"type": "object"}},
            {"name": "fail_tool", "description": "isError",
             "inputSchema": {"type": "object"}},
            {"name": "sleep_forever", "description": "never answers",
             "inputSchema": {"type": "object"}},
        ]}})
    elif method == "tools/call":
        name = msg["params"]["name"]
        if name == "echo_ok":
            tool_result(req_id, '{"ok": true}')
        elif name == "fail_tool":
            tool_result(req_id, "busted by mock", is_error=True)
        elif name == "sleep_forever":
            threading.Thread(target=time.sleep, args=(3600,), daemon=True).start()
            # ответа не будет — клиент должен уйти по таймауту
        else:
            send({"jsonrpc": "2.0", "id": req_id,
                  "error": {"code": -32602, "message": f"unknown tool {name}"}})
    # notifications (initialized, cancelled) и прочее — молча игнорируем


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if line:
            handle(line)


if __name__ == "__main__":
    main()
