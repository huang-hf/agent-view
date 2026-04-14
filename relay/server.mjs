import { randomUUID } from "crypto"
import fs from "fs"
import path from "path"
import { extractOpenIdCandidates } from "./openid-extract.mjs"

const env = process.env

const config = {
  host: env.RELAY_HOST || "0.0.0.0",
  port: Number(env.RELAY_PORT || 8787),
  eventPath: env.RELAY_EVENT_PATH || "/agent-view/events",
  qqCallbackPath: env.RELAY_QQ_CALLBACK_PATH || "/qq/callback",
  manualReplyPath: env.RELAY_MANUAL_REPLY_PATH || "/debug/reply",
  eventAuthToken: env.AV_NOTIFY_TOKEN || "",
  callbackAuthToken: env.RELAY_CALLBACK_TOKEN || "",
  actionUrl: env.AGENT_VIEW_ACTION_URL || "http://127.0.0.1:5177/notify/action",
  actionSecret: env.AV_NOTIFY_ACTION_SECRET || "",
  actionTimeoutMs: Number(env.ACTION_TIMEOUT_MS || 5000),
  codeTtlSeconds: Number(env.CODE_TTL_SECONDS || 300),
  qqAppId: env.QQ_APP_ID || "",
  qqAppSecret: env.QQ_APP_SECRET || "",
  qqApiBase: env.QQ_API_BASE || "https://api.sgroup.qq.com",
  qqTokenUrl: env.QQ_TOKEN_URL || "https://bots.qq.com/app/getAppAccessToken",
  discoveredOpenidFile: env.DISCOVERED_OPENID_FILE || path.join(process.cwd(), "discovered-openids.log"),
  userTargets: splitCsv(env.QQ_TARGET_USER_OPENID),
  groupTargets: splitCsv(env.QQ_TARGET_GROUP_OPENID),
}

if (!config.qqAppId || !config.qqAppSecret) {
  console.error("Missing QQ_APP_ID or QQ_APP_SECRET")
  process.exit(1)
}

if (!config.eventAuthToken) {
  console.error("Missing AV_NOTIFY_TOKEN")
  process.exit(1)
}

let qqTokenCache = {
  token: "",
  expiresAtMs: 0,
}

const codeStore = new Map() // code -> { token, expiresAt, sessionId, title }
const discoveredOpenids = new Set()

function splitCsv(value) {
  if (!value) return []
  return value.split(",").map(s => s.trim()).filter(Boolean)
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function requireBearer(req, token) {
  const auth = req.headers.get("authorization") || ""
  return auth === `Bearer ${token}`
}

async function getQQAccessToken() {
  const now = Date.now()
  if (qqTokenCache.token && now < qqTokenCache.expiresAtMs - 60_000) {
    return qqTokenCache.token
  }

  const res = await fetch(config.qqTokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      appId: config.qqAppId,
      clientSecret: config.qqAppSecret,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`getAppAccessToken failed: ${res.status} ${text}`)
  }

  const data = await res.json()
  const token = data.access_token
  const expiresIn = Number(data.expires_in || 7200)
  if (!token) {
    throw new Error("QQ access token missing in response")
  }

  qqTokenCache = {
    token,
    expiresAtMs: Date.now() + expiresIn * 1000,
  }
  return token
}

async function sendQQMessageToUser(openid, content) {
  const accessToken = await getQQAccessToken()
  const url = `${config.qqApiBase}/v2/users/${encodeURIComponent(openid)}/messages`
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `QQBot ${accessToken}`,
      "x-union-appid": config.qqAppId,
    },
    body: JSON.stringify({
      openid,
      msg_type: 0,
      content,
      msg_id: randomUUID(),
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`send user message failed(${openid}): ${res.status} ${text}`)
  }
}

async function sendQQMessageToGroup(groupOpenid, content) {
  const accessToken = await getQQAccessToken()
  const url = `${config.qqApiBase}/v2/groups/${encodeURIComponent(groupOpenid)}/messages`
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `QQBot ${accessToken}`,
      "x-union-appid": config.qqAppId,
    },
    body: JSON.stringify({
      group_openid: groupOpenid,
      msg_type: 0,
      content,
      msg_id: randomUUID(),
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`send group message failed(${groupOpenid}): ${res.status} ${text}`)
  }
}

async function notifyTargets(content) {
  const tasks = []
  for (const openid of config.userTargets) {
    tasks.push(sendQQMessageToUser(openid, content))
  }
  for (const groupOpenid of config.groupTargets) {
    tasks.push(sendQQMessageToGroup(groupOpenid, content))
  }
  if (tasks.length === 0) {
    console.warn("No QQ targets configured (QQ_TARGET_USER_OPENID / QQ_TARGET_GROUP_OPENID)")
    return
  }
  const results = await Promise.allSettled(tasks)
  const failures = results.filter(r => r.status === "rejected")
  if (failures.length > 0) {
    const reasons = failures.map(f => f.reason?.message || String(f.reason)).join("; ")
    throw new Error(`notify failed: ${reasons}`)
  }
}

function issueCode(entry) {
  for (let i = 0; i < 5; i++) {
    const code = Math.random().toString(36).slice(2, 8).toUpperCase()
    if (!codeStore.has(code)) {
      codeStore.set(code, entry)
      return code
    }
  }
  const fallback = randomUUID().slice(0, 8).toUpperCase()
  codeStore.set(fallback, entry)
  return fallback
}

function cleanupCodes() {
  const now = Date.now()
  for (const [code, entry] of codeStore.entries()) {
    if (entry.expiresAt <= now) {
      codeStore.delete(code)
    }
  }
}

async function callAgentViewAction(token, action) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), config.actionTimeoutMs)

  try {
    const headers = {
      "content-type": "application/json",
    }
    if (config.actionSecret) {
      headers["x-av-secret"] = config.actionSecret
    }

    const res = await fetch(config.actionUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ token, action }),
      signal: controller.signal,
    })

    const text = await res.text()
    if (!res.ok) {
      throw new Error(`agent-view action failed: ${res.status} ${text}`)
    }

    return text
  } finally {
    clearTimeout(t)
  }
}

function parseReplyCommand(text) {
  const cleaned = String(text || "").trim()
  const m = cleaned.match(/\b(yes|no)\s+([A-Za-z0-9]{6,12})\b/i)
  if (!m) return null
  return {
    action: m[1].toLowerCase(),
    code: m[2].toUpperCase(),
  }
}

function extractContent(payload) {
  return (
    payload?.content ||
    payload?.d?.content ||
    payload?.message?.content ||
    payload?.data?.content ||
    ""
  )
}

function recordDiscoveredOpenids(payload) {
  const candidates = extractOpenIdCandidates(payload)
  if (candidates.length === 0) return []

  const fresh = []
  for (const id of candidates) {
    if (discoveredOpenids.has(id)) continue
    discoveredOpenids.add(id)
    fresh.push(id)
  }

  if (fresh.length > 0) {
    const dir = path.dirname(config.discoveredOpenidFile)
    fs.mkdirSync(dir, { recursive: true })
    for (const id of fresh) {
      const line = `${new Date().toISOString()} ${id}\n`
      fs.appendFileSync(config.discoveredOpenidFile, line, "utf8")
      console.log(`[openid] discovered: ${id}`)
    }
  }

  return candidates
}

async function handleWaitingEvent(req) {
  if (!requireBearer(req, config.eventAuthToken)) {
    return json(401, { ok: false, message: "unauthorized" })
  }

  let body
  try {
    body = await req.json()
  } catch {
    return json(400, { ok: false, message: "invalid json" })
  }

  const event = body?.event
  const data = body?.data || {}
  if (event !== "session.waiting" || !data.actionToken || !data.sessionId) {
    return json(400, { ok: false, message: "invalid event payload" })
  }

  cleanupCodes()
  const code = issueCode({
    token: data.actionToken,
    sessionId: data.sessionId,
    title: data.title || data.sessionId,
    expiresAt: Date.now() + config.codeTtlSeconds * 1000,
  })

  const message = [
    "[agent-view] 会话需要确认",
    `title: ${data.title || "(untitled)"}`,
    `session: ${data.sessionId}`,
    `action: 回复 \"yes ${code}\" 或 \"no ${code}\"`,
    `expires: ${config.codeTtlSeconds}s`,
  ].join("\n")

  try {
    await notifyTargets(message)
    return json(200, { ok: true, code })
  } catch (err) {
    console.error("notify failed", err)
    return json(502, { ok: false, message: err.message || String(err) })
  }
}

async function handleIncomingReply(req) {
  if (config.callbackAuthToken) {
    const provided = req.headers.get("x-relay-token") || ""
    if (provided !== config.callbackAuthToken) {
      return json(401, { ok: false, message: "unauthorized" })
    }
  }

  let body
  try {
    body = await req.json()
  } catch {
    return json(400, { ok: false, message: "invalid json" })
  }

  const ids = recordDiscoveredOpenids(body)

  const command = parseReplyCommand(extractContent(body))
  if (!command) {
    return json(200, { ok: true, ignored: true, message: "no yes/no command found", discovered: ids })
  }

  cleanupCodes()
  const entry = codeStore.get(command.code)
  if (!entry) {
    return json(404, { ok: false, message: "code not found or expired" })
  }

  try {
    await callAgentViewAction(entry.token, command.action)
    codeStore.delete(command.code)
    return json(200, {
      ok: true,
      action: command.action,
      sessionId: entry.sessionId,
      title: entry.title,
    })
  } catch (err) {
    console.error("agent-view action failed", err)
    return json(502, { ok: false, message: err.message || String(err) })
  }
}

async function handleManualReply(req) {
  if (!requireBearer(req, config.eventAuthToken)) {
    return json(401, { ok: false, message: "unauthorized" })
  }

  let body
  try {
    body = await req.json()
  } catch {
    return json(400, { ok: false, message: "invalid json" })
  }

  const action = String(body?.action || "").toLowerCase()
  const code = String(body?.code || "").toUpperCase()
  if ((action !== "yes" && action !== "no") || !code) {
    return json(400, { ok: false, message: "expect { action: yes|no, code }" })
  }

  const entry = codeStore.get(code)
  if (!entry) {
    return json(404, { ok: false, message: "code not found" })
  }

  try {
    await callAgentViewAction(entry.token, action)
    codeStore.delete(code)
    return json(200, { ok: true, sessionId: entry.sessionId, action })
  } catch (err) {
    return json(502, { ok: false, message: err.message || String(err) })
  }
}

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  fetch(req) {
    const path = new URL(req.url).pathname

    if (path === "/healthz") {
      return json(200, { ok: true })
    }

    if (path === "/debug/openids" && req.method === "GET") {
      return json(200, { ok: true, openids: [...discoveredOpenids] })
    }

    if (path === config.eventPath && req.method === "POST") {
      return handleWaitingEvent(req)
    }

    if (path === config.qqCallbackPath && req.method === "POST") {
      return handleIncomingReply(req)
    }

    if (path === config.manualReplyPath && req.method === "POST") {
      return handleManualReply(req)
    }

    return json(404, { ok: false, message: "not found" })
  },
})

console.log(`relay listening on http://${config.host}:${config.port}`)
console.log(`event endpoint: POST ${config.eventPath}`)
console.log(`qq callback endpoint: POST ${config.qqCallbackPath}`)
console.log(`manual reply endpoint: POST ${config.manualReplyPath}`)
console.log(`openid file: ${config.discoveredOpenidFile}`)
