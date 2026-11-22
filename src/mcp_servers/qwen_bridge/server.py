"""MCP-обертка qwen_bridge: слот «Мозг» шины L2T (локальный qwen-stack).

Транспорт stdio. Поддерживаются оба поколения SDK через шим (как midi_gen):
mcp 1.x — FastMCP, mcp 2.x — MCPServer (переименование API).

Особенность 2.x, важная для контракта шины №3: текст ошибки до модели
доносит только ToolError — любое другое исключение в теле инструмента
превращается в безликое "Error executing tool <name>". Поэтому ошибки
логики переупаковываются через ``_bounded`` (в 1.x isError с текстом
даёт любое исключение — там переупаковка без-op).

Файлов не касаемся вообще (workspace-правила неприменимы); секрет — только
из env (PROXY_API_KEY). Все вызовы bounded: httpx timeout 60 c.

Запуск:
    l2t-qwen-brain   # MCP stdio (для конфига ZCode / Claude / Cursor)
"""

from __future__ import annotations

import sys

try:
    from mcp.server.fastmcp import FastMCP  # mcp SDK 1.x
except ImportError:  # mcp SDK 2.x
    from mcp.server.mcpserver import MCPServer as FastMCP

try:  # SDK 2.x: до клиента доносит текст только ToolError
    from mcp.server.mcpserver.exceptions import ToolError as _ToolError
except ImportError:  # SDK 1.x: любое исключение уже попадает в isError с текстом
    _ToolError = None  # type: ignore[assignment]

from mcp_servers.qwen_bridge import logic as brain

mcp = FastMCP("qwen-brain")

_CAUGHT = (brain.ProxyError, ValueError)


def _bounded(exc: Exception) -> Exception:
    """Переупаковать ошибку так, чтобы её текст дошёл до модели (правило №3)."""
    return _ToolError(str(exc)) if _ToolError is not None else exc


@mcp.tool(name="brain.chat")
def chat(prompt: str, session: str = "default", persona: str | None = None,
         max_tokens: int = 1024) -> dict:
    """Chat with the local qwen-stack brain (OpenAI-compatible memory proxy).

    The proxy injects the session's dialog memory server-side; with `persona`
    set, the persona's system prompt and few-shots are applied too
    (see brain.personas).

    Args:
        prompt: User message.
        session: Memory session id ("default" keeps a single thread).
        persona: Optional persona id (persona_<id>.py in the proxy).
        max_tokens: Generation cap.

    Returns:
        Compact JSON: {"text": ..., "session": ..., "persona": ...}.
    """
    try:
        if not prompt.strip():
            raise ValueError("prompt пустой")
        if max_tokens < 1:
            raise ValueError(f"max_tokens должен быть >= 1, получил {max_tokens}")
        return brain.chat(prompt, session, persona, max_tokens)
    except _CAUGHT as exc:
        raise _bounded(exc) from exc


@mcp.tool(name="brain.memory_search")
def memory_search(query: str, session: str | None = None) -> dict:
    """Search qwen-stack dialog memory (all sessions, or one if `session` set).

    Args:
        query: Substring to search message contents for.
        session: Optional session id to narrow the search.

    Returns:
        Compact JSON: {"query", "session", "count", "hits": [{session, role,
        content}]} — up to 50 hits, newest first.
    """
    try:
        if not query.strip():
            raise ValueError("query пустой")
        return brain.memory_search(query, session)
    except _CAUGHT as exc:
        raise _bounded(exc) from exc


@mcp.tool(name="brain.forget")
def forget(session: str) -> dict:
    """Clear a session's dialog memory (messages + summary). Irreversible.

    Args:
        session: Session id to wipe.

    Returns:
        Confirmation JSON: {"cleared": "<session>"}.
    """
    try:
        if not session.strip():
            raise ValueError("session пустой")
        return brain.forget(session)
    except _CAUGHT as exc:
        raise _bounded(exc) from exc


@mcp.tool(name="brain.personas")
def personas() -> dict:
    """List available brain personas (persona_*.py in the proxy).

    Returns:
        Compact JSON: {"personas": ["<id>", ...]}.
    """
    try:
        return brain.personas()
    except brain.ProxyError as exc:
        raise _bounded(exc) from exc


@mcp.tool(name="brain.vision_analyze")
def vision_analyze(source: str = "screen", path: str | None = None) -> dict:
    """Describe what the brain sees: a live screenshot or an image file.

    Args:
        source: "screen" (grab the screen) or "image" (read `path`).
        path: Image file path, required for source="image".

    Returns:
        Compact JSON: {"description": ..., "source": ..., "path": ...}.
    """
    try:
        return brain.vision_analyze(source, path)
    except _CAUGHT as exc:
        raise _bounded(exc) from exc


def main(argv: list[str] | None = None) -> None:
    argv = sys.argv[1:] if argv is None else list(argv)
    if argv:
        # Урок Wave 2 (см. midi_gen): неизвестный аргумент = usage-ошибка,
        # а не молчаливый старт stdio-сервера, «зависающего» на пустом stdin.
        print("usage: l2t-qwen-brain   # MCP stdio (для конфига клиента)",
              file=sys.stderr)
        sys.exit(2)
    mcp.run("stdio")


if __name__ == "__main__":
    main()
