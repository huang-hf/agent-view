#!/usr/bin/env python3
"""
Local QQ WebSocket bridge (no public callback URL required).

This process connects to QQ via botpy websocket, listens for incoming messages,
and forwards message content + user identifiers to local relay /qq/callback.
"""

import json
import os
import sys
import urllib.request
from typing import Any, Dict

try:
    import botpy
except Exception as exc:  # pragma: no cover
    print("Missing dependency: qq-botpy. Install with: pip install qq-botpy", file=sys.stderr)
    raise

RELAY_CALLBACK_URL = os.getenv("RELAY_LOCAL_CALLBACK_URL", "http://127.0.0.1:8787/qq/callback")
RELAY_CALLBACK_TOKEN = os.getenv("RELAY_CALLBACK_TOKEN", "")
QQ_APP_ID = os.getenv("QQ_APP_ID", "")
QQ_APP_SECRET = os.getenv("QQ_APP_SECRET", "")

if not QQ_APP_ID or not QQ_APP_SECRET:
    print("Missing QQ_APP_ID or QQ_APP_SECRET in environment", file=sys.stderr)
    sys.exit(1)


def _post_callback(payload: Dict[str, Any]) -> None:
    data = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if RELAY_CALLBACK_TOKEN:
        headers["x-relay-token"] = RELAY_CALLBACK_TOKEN
    req = urllib.request.Request(RELAY_CALLBACK_URL, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=5) as resp:
        _ = resp.read()


def _safe_get(obj: Any, *attrs: str) -> Any:
    cur = obj
    for attr in attrs:
        if cur is None:
            return None
        cur = getattr(cur, attr, None)
    return cur


def _build_payload(message: Any) -> Dict[str, Any]:
    content = _safe_get(message, "content") or ""
    author_id = _safe_get(message, "author", "id") or ""

    # Try multiple potential id fields used by different message types.
    openid = (
        _safe_get(message, "openid")
        or _safe_get(message, "author", "member_openid")
        or _safe_get(message, "author", "user_openid")
        or ""
    )

    group_openid = _safe_get(message, "group_openid") or ""

    payload = {
        "content": content,
        "author": {"id": author_id},
        "openid": openid,
        "group_openid": group_openid,
    }
    return payload


class BridgeClient(botpy.Client):
    def ws_dispatch(self, event: str, *args, **kwargs):
        print(f"[botpy-bridge] event={event}")
        return super().ws_dispatch(event, *args, **kwargs)

    async def on_ready(self):
        print("[botpy-bridge] connected")

    async def _forward(self, event_name: str, message):
        payload = _build_payload(message)
        print(
            f"[botpy-bridge] {event_name} ids: "
            f"author.id={payload.get('author', {}).get('id', '')} "
            f"openid={payload.get('openid', '')} "
            f"group_openid={payload.get('group_openid', '')}"
        )
        try:
            _post_callback(payload)
            print(f"[botpy-bridge] forwarded {event_name} message")
        except Exception as exc:
            print(f"[botpy-bridge] forward failed ({event_name}): {exc}", file=sys.stderr)

    async def on_c2c_message_create(self, message):
        await self._forward("c2c", message)

    async def on_group_at_message_create(self, message):
        await self._forward("group_at", message)

    async def on_direct_message_create(self, message):
        await self._forward("direct", message)

    async def on_message_create(self, message):
        await self._forward("message_create", message)

    async def on_at_message_create(self, message):
        await self._forward("at_message", message)


# Intents naming differs across versions; set what exists.
def _build_intents():
    intents = botpy.Intents.none()
    enabled = []

    candidates = [
        "public_messages",
        "public_guild_messages",
        "guild_messages",
        "at_messages",
        "direct_message",
        "group_at_message_create",
        "group_messages",
        "c2c_message",
        "c2c_message_create",
        "interaction",
    ]

    for name in candidates:
        if hasattr(intents, name):
            setattr(intents, name, True)
            enabled.append(name)

    print(f"[botpy-bridge] intents enabled: {enabled}")
    return intents


if __name__ == "__main__":
    intents = _build_intents()
    client = BridgeClient(intents=intents)
    client.run(appid=QQ_APP_ID, secret=QQ_APP_SECRET)
