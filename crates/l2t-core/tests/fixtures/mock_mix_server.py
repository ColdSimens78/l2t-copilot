#!/usr/bin/env python3
"""Мок движка (soundcraft MCP-формы) для тестов mix-фасадов l2t-core.

Инструменты (те же имена, что у standalone-движка):
  execute         — mix.volume/mix.pan/mix.mute/mix.solo; в ответе `echo`
                    с точной формой вызова (тесты сверяют фасад с движком),
                    применение меняет внутреннее состояние
  inspect_session — снимок сессии: треки с volume_db/pan/mute/solo из
                    состояния (применённые mix-команды видны)

Неизвестная mix-команда — isError, как у движка. Чтение — построчно.
"""

import json
import sys

# id → {name, kind, volume_db, pan, mute, solo} — меняется execute-ом
STATE = {
    1: {"name": "Bass", "kind": "instrument", "volume_db": -5.0,
        "pan": [0.0], "mute": False, "solo": False},
    2: {"name": "Chords", "kind": "instrument", "volume_db": -7.0,
        "pan": [0.35], "mute": False, "solo": False},
    3: {"name": "Master 1", "kind": "master", "volume_db": 0.0,
        "pan": [-1.0, 1.0], "mute": False, "solo": False},
}


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


def track_ids(params: dict) -> list[int]:
    ids = params.get("tracks")
    return list(ids) if isinstance(ids, list) else list(STATE)


def apply(command: str, params: dict) -> str:
    if command == "mix.volume":
        if ("db" in params) == ("delta_db" in params):
            return tool_error(command, "ровно одно из db / delta_db")
        if "db" in params and not -144.0 <= params["db"] <= 12.0:
            return tool_error(command, "db вне диапазона")
        for tid in track_ids(params):
            track = STATE.get(tid)
            if track is None:
                return tool_error(command, f"unknown track {tid}")
            if "db" in params:
                track["volume_db"] = float(params["db"])
            else:
                track["volume_db"] = round(track["volume_db"] + params["delta_db"], 2)
        return echo(command, params, {"tracks": len(track_ids(params))})
    if command == "mix.pan":
        pan = params.get("pan")
        if not isinstance(pan, (int, float)) or not -1.0 <= pan <= 1.0:
            return tool_error(command, "pan вне диапазона")
        for tid in track_ids(params):
            track = STATE.get(tid)
            if track is None:
                return tool_error(command, f"unknown track {tid}")
            if len(track["pan"]) == 1:
                track["pan"] = [float(pan)]
        return echo(command, params, {"pan": pan})
    if command in ("mix.mute", "mix.solo"):
        key = "mute" if command == "mix.mute" else "solo"
        for tid in track_ids(params):
            track = STATE.get(tid)
            if track is None:
                return tool_error(command, f"unknown track {tid}")
            track[key] = bool(params.get("on"))
        return echo(command, params, {"value": bool(params.get("on"))})
    return tool_error(command, "не mix-команда")


def echo(command: str, params: dict, result: dict) -> str:
    return json.dumps({"echo": {"command": command, "params": params}, **result},
                      ensure_ascii=False)


def tool_error(command: str, message: str) -> str:
    return json.dumps({"error": f"bad parameters for `{command}`: {message}"},
                      ensure_ascii=False)


def handle(line: str) -> None:
    msg = json.loads(line)
    method = msg.get("method", "")
    req_id = msg.get("id")
    if method == "initialize":
        send({"jsonrpc": "2.0", "id": req_id, "result": {
            "protocolVersion": "2024-11-05",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "mock-mix", "version": "0"},
        }})
    elif method == "tools/list":
        send({"jsonrpc": "2.0", "id": req_id, "result": {"tools": [
            {"name": "execute", "description": "engine command",
             "inputSchema": {"type": "object"}},
            {"name": "inspect_session", "description": "session snapshot",
             "inputSchema": {"type": "object"}},
        ]}})
    elif method == "tools/call":
        name = msg["params"]["name"]
        args = msg["params"].get("arguments", {})
        if name == "execute":
            out = apply(args.get("command", ""), args.get("params", {}))
            data = json.loads(out)
            tool_result(req_id, out, is_error="error" in data)
        elif name == "inspect_session":
            tracks = [
                {"id": tid, "clips": [], "instrument": None, **fields}
                for tid, fields in STATE.items()
            ]
            tool_result(req_id, json.dumps({
                "sample_rate": 48000, "name": "mock-mix", "tracks": tracks,
            }))
        else:
            send({"jsonrpc": "2.0", "id": req_id,
                  "error": {"code": -32602, "message": f"unknown tool {name}"}})
    # notifications (initialized, cancelled) — молча


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if line:
            handle(line)


if __name__ == "__main__":
    main()
