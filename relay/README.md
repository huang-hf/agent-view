# agent-view QQ Relay

A minimal relay service for `agent-view` notify mode.

It does four things:

1. Receives `session.waiting` webhooks from `agent-view`
2. Sends QQ Official Bot notifications (user and/or group)
3. Parses `yes CODE` / `no CODE` replies from callback payloads
4. Calls back `agent-view` action endpoint (`/notify/action`)

## No Public URL Mode (Recommended)

You do **not** need a public callback URL.

Run a local websocket bridge (`botpy_bridge.py`) that connects outbound to QQ
and forwards incoming QQ messages to local relay `/qq/callback`.

## Run

```bash
cd relay
cp .env.example .env
# edit .env
bun run server.mjs
```

In another terminal:

```bash
cd relay
pip install qq-botpy
set -a; source .env; set +a
python3 botpy_bridge.py
```

## Endpoints

- `POST /agent-view/events`
  - Auth: `Authorization: Bearer <AV_NOTIFY_TOKEN>`
  - Body (from agent-view):
  ```json
  {
    "event": "session.waiting",
    "data": {
      "actionToken": "uuid",
      "sessionId": "...",
      "title": "..."
    }
  }
  ```

- `POST /qq/callback`
  - Accepts message events forwarded by local websocket bridge (`botpy_bridge.py`)
  - Parses text content and looks for:
  - `yes <CODE>`
  - `no <CODE>`
  - Also auto-discovers user IDs/openids and appends new ones to `DISCOVERED_OPENID_FILE`

- `POST /debug/reply`
  - Auth: same bearer token as event endpoint
  - Manual test fallback:
  ```json
  { "action": "yes", "code": "ABC123" }
  ```

- `GET /debug/openids`
  - Returns openids discovered during current process lifetime

## Required `.env`

- `AV_NOTIFY_TOKEN`
- `AV_NOTIFY_ACTION_SECRET` (if enabled in agent-view action server)
- `QQ_APP_ID`
- `QQ_APP_SECRET`
- at least one target:
  - `QQ_TARGET_USER_OPENID`
  - `QQ_TARGET_GROUP_OPENID`

For local websocket bridge:
- `RELAY_LOCAL_CALLBACK_URL` (usually `http://127.0.0.1:8787/qq/callback`)

## Reply format

The relay sends messages with a short code. Reply with:

- `yes ABC123`
- `no ABC123`

`yes`: relay calls `agent-view` action endpoint with `action=yes`

`no`: relay calls `agent-view` action endpoint with `action=no` (which is currently ignore-this-event only)

## Integration with agent-view

In `~/.agent-view/config.json`:

```json
{
  "notify": {
    "enabled": true,
    "webhookUrl": "http://127.0.0.1:8787/agent-view/events",
    "webhookTokenEnv": "AV_NOTIFY_TOKEN",
    "cooldownSeconds": 300,
    "tokenTtlSeconds": 300,
    "pollIntervalMs": 500,
    "actionServer": {
      "enabled": true,
      "host": "127.0.0.1",
      "port": 5177,
      "path": "/notify/action",
      "secretEnv": "AV_NOTIFY_ACTION_SECRET"
    }
  }
}
```

Then run `av -r` and keep relay running.

## Notes

- This relay assumes your QQ callback payload includes a text field (`content` or `d.content`).
- If you use a gateway/framework in front of QQ callbacks, forward the original content to `/qq/callback`.

## How To Get Your Personal OpenID

1. Start relay.
2. Start local websocket bridge: `python3 botpy_bridge.py`.
3. Send any message to your bot from your personal QQ.
4. Check discovered IDs:
   - `GET /debug/openids`
   - or read `DISCOVERED_OPENID_FILE` (default `./discovered-openids.log`)
5. Pick your user ID and set `QQ_TARGET_USER_OPENID=<that id>` in `.env`.

If your bot platform still enforces webhook callbacks in your app settings, keep that configured for platform compliance, but the runtime message ingestion for this local flow is via websocket bridge.
