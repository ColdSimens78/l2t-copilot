"""qwen_bridge — MCP-сервер слота «Мозг» шины L2T (локальный qwen-stack).

Слои: logic.py — чистые HTTP-вызовы к memory_proxy (только httpx, ничего
про MCP), server.py — MCP-обертка (dual-шим SDK 1.x/2.x, stdio). Прокси
подставляет память диалогов и персон сам; здесь только транспорт.
"""

__version__ = "0.1.0"
