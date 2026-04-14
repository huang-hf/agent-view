import { getStorage } from "@/core/storage"
import { SessionManager } from "@/core/session"
import { getRemoteManager } from "@/core/remote"
import type { RemoteSession, Session } from "@/core/types"
import { paginateTranscript } from "@/core/transcript"
import { renderWebAppHtml } from "./ui"
import { getServiceWorkerScript } from "./sw"

interface WebServerOptions {
  host: string
  port: number
}

interface WebSession {
  id: string
  nativeId: string
  title: string
  order: number
  status: string
  tool: string
  groupPath: string
  acknowledged: boolean
  lastAccessed: Date
  isRemote: boolean
  remoteName?: string
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  })
}

function text(data: string, status = 200): Response {
  return new Response(data, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8"
    }
  })
}

function html(data: string): Response {
  return new Response(data, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    }
  })
}

function makeLocalKey(id: string): string {
  return `l:${id}`
}

function makeRemoteKey(remoteName: string, id: string): string {
  return `r:${encodeURIComponent(remoteName)}:${id}`
}

function parseSessionKey(key: string): { kind: "local"; id: string } | { kind: "remote"; remoteName: string; id: string } | null {
  if (key.startsWith("l:")) {
    const id = key.slice(2)
    if (!id) return null
    return { kind: "local", id }
  }

  if (key.startsWith("r:")) {
    const parts = key.split(":")
    if (parts.length < 3) return null
    const remoteName = decodeURIComponent(parts[1] || "")
    const id = parts.slice(2).join(":")
    if (!remoteName || !id) return null
    return { kind: "remote", remoteName, id }
  }

  return null
}

function getIdFromPath(pathname: string, suffix: string): string | null {
  if (!pathname.endsWith(suffix)) return null
  const raw = pathname.slice(0, -suffix.length)
  const parts = raw.split("/").filter(Boolean)
  if (parts.length < 3) return null
  return decodeURIComponent(parts[2]!)
}

async function loadUnifiedSessions(remoteManager: ReturnType<typeof getRemoteManager>, storage = getStorage()): Promise<{ local: Session[]; remote: RemoteSession[]; unified: WebSession[] }> {
  const localSessions = storage.loadSessions()
  const remoteSessions = await remoteManager.fetchAllSessions(false)

  const local: WebSession[] = localSessions.map((s) => ({
    id: makeLocalKey(s.id),
    nativeId: s.id,
    title: s.title,
    order: s.order,
    status: s.status,
    tool: s.tool,
    groupPath: s.groupPath,
    acknowledged: s.acknowledged,
    lastAccessed: s.lastAccessed,
    isRemote: false,
  }))

  const remote: WebSession[] = remoteSessions.map((s) => ({
    id: makeRemoteKey(s.remoteName, s.id),
    nativeId: s.id,
    title: s.title,
    order: s.order,
    status: s.status,
    tool: s.tool,
    groupPath: s.groupPath,
    acknowledged: s.acknowledged,
    lastAccessed: s.lastAccessed,
    isRemote: true,
    remoteName: s.remoteName,
  }))

  return {
    local: localSessions,
    remote: remoteSessions,
    unified: [...local, ...remote]
  }
}

function lastPreviewLine(lines: string[]): string {
  return lines.slice(-2).join(" ").slice(0, 180)
}

export async function startWebServer(options: WebServerOptions): Promise<void> {
  const manager = new SessionManager()
  const storage = getStorage()
  const remoteManager = getRemoteManager()

  manager.startRefreshLoop(500)

  Bun.serve({
    hostname: options.host,
    port: options.port,
    idleTimeout: 30,
    fetch: async (req) => {
      const url = new URL(req.url)
      const pathname = url.pathname

      if (pathname === "/") {
        return html(renderWebAppHtml())
      }

      if (pathname === "/api/health") {
        return json({ ok: true, now: Date.now() })
      }

      if (pathname === "/sw.js") {
        return new Response(getServiceWorkerScript(), {
          headers: {
            "content-type": "application/javascript; charset=utf-8",
            "cache-control": "no-store"
          }
        })
      }

      if (pathname === "/api/sessions") {
        const { unified } = await loadUnifiedSessions(remoteManager, storage)
        return json(unified)
      }

      if (pathname === "/api/inbox") {
        const { local, remote } = await loadUnifiedSessions(remoteManager, storage)

        const localInbox = local.filter((s) => (s.status === "waiting" || s.status === "error") && !s.acknowledged)
        const remoteInbox = remote.filter((s) => (s.status === "waiting" || s.status === "error") && !s.acknowledged)

        const localItems = await Promise.all(localInbox.map(async (s) => {
          const page = await manager.getOutputPage(s.id, { before: 0, limit: 30, maxLines: 300 })
          return {
            id: makeLocalKey(s.id),
            title: s.title,
            status: s.status,
            tool: s.tool,
            groupPath: s.groupPath,
            isRemote: false,
            preview: lastPreviewLine(page.lines)
          }
        }))

        const remoteItems = await Promise.all(remoteInbox.map(async (s) => {
          let preview = "Needs attention"
          try {
            const raw = await remoteManager.getOutput(s, 120)
            const lines = raw.split("\n").filter(Boolean)
            preview = lastPreviewLine(lines)
          } catch {
            // Keep fallback preview
          }

          return {
            id: makeRemoteKey(s.remoteName, s.id),
            title: s.title,
            status: s.status,
            tool: s.tool,
            groupPath: s.groupPath,
            isRemote: true,
            remoteName: s.remoteName,
            preview
          }
        }))

        return json([...localItems, ...remoteItems])
      }

      if (pathname.startsWith("/api/sessions/") && pathname.endsWith("/acknowledge") && req.method === "POST") {
        const key = getIdFromPath(pathname, "/acknowledge")
        if (!key) return text("invalid session path", 400)

        const parsed = parseSessionKey(key)
        if (!parsed) return text("invalid session id", 400)

        if (parsed.kind === "local") {
          manager.acknowledge(parsed.id)
          return json({ ok: true })
        }

        const remotes = await remoteManager.fetchAllSessions(false)
        const remoteSession = remotes.find((s) => s.remoteName === parsed.remoteName && s.id === parsed.id)
        if (!remoteSession) return text("remote session not found", 404)
        await remoteManager.acknowledgeSession(remoteSession)
        return json({ ok: true })
      }

      if (pathname.startsWith("/api/sessions/") && pathname.endsWith("/transcript")) {
        const key = getIdFromPath(pathname, "/transcript")
        if (!key) return text("invalid session path", 400)

        const parsed = parseSessionKey(key)
        if (!parsed) return text("invalid session id", 400)

        const before = parseInt(url.searchParams.get("before") ?? "0", 10)
        const limit = parseInt(url.searchParams.get("limit") ?? "200", 10)
        const maxLines = parseInt(url.searchParams.get("maxLines") ?? "1000", 10)
        const beforeSafe = Number.isFinite(before) ? before : 0
        const limitSafe = Number.isFinite(limit) ? limit : 200
        const maxLinesSafe = Number.isFinite(maxLines) ? maxLines : 1000

        if (parsed.kind === "local") {
          const page = await manager.getOutputPage(parsed.id, {
            before: beforeSafe,
            limit: limitSafe,
            maxLines: maxLinesSafe,
          })
          return json(page)
        }

        const remotes = await remoteManager.fetchAllSessions(false)
        const remoteSession = remotes.find((s) => s.remoteName === parsed.remoteName && s.id === parsed.id)
        if (!remoteSession) return text("remote session not found", 404)

        try {
          const raw = await remoteManager.getOutput(remoteSession, maxLinesSafe)
          const lines = raw.split("\n")
          while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") {
            lines.pop()
          }
          const page = paginateTranscript(lines, {
            before: beforeSafe,
            limit: limitSafe,
            maxLines: maxLinesSafe,
          })
          return json({
            text: page.lines.join("\n"),
            lines: page.lines,
            nextBefore: page.nextBefore,
            hasMore: page.hasMore,
            total: page.total,
          })
        } catch (error) {
          return text(error instanceof Error ? error.message : String(error), 400)
        }
      }

      if (pathname.startsWith("/api/sessions/") && pathname.endsWith("/send") && req.method === "POST") {
        const key = getIdFromPath(pathname, "/send")
        if (!key) return text("invalid session path", 400)

        const parsed = parseSessionKey(key)
        if (!parsed) return text("invalid session id", 400)

        const payload = await req.json().catch(() => null) as { message?: string } | null
        const message = payload?.message?.trim()
        if (!message) return text("message is required", 400)

        try {
          if (parsed.kind === "local") {
            await manager.sendMessage(parsed.id, message)
          } else {
            const remotes = await remoteManager.fetchAllSessions(false)
            const remoteSession = remotes.find((s) => s.remoteName === parsed.remoteName && s.id === parsed.id)
            if (!remoteSession) return text("remote session not found", 404)
            await remoteManager.sendMessage(remoteSession, message)
          }
          return json({ ok: true })
        } catch (error) {
          return text(error instanceof Error ? error.message : String(error), 400)
        }
      }

      if (pathname.startsWith("/api/sessions/") && pathname.endsWith("/confirm") && req.method === "POST") {
        const key = getIdFromPath(pathname, "/confirm")
        if (!key) return text("invalid session path", 400)

        const parsed = parseSessionKey(key)
        if (!parsed) return text("invalid session id", 400)

        try {
          if (parsed.kind === "local") {
            await manager.confirm(parsed.id)
          } else {
            const remotes = await remoteManager.fetchAllSessions(false)
            const remoteSession = remotes.find((s) => s.remoteName === parsed.remoteName && s.id === parsed.id)
            if (!remoteSession) return text("remote session not found", 404)
            await remoteManager.confirmSession(remoteSession)
          }
          return json({ ok: true })
        } catch (error) {
          return text(error instanceof Error ? error.message : String(error), 400)
        }
      }

      if (pathname.startsWith("/api/sessions/") && pathname.endsWith("/interrupt") && req.method === "POST") {
        const key = getIdFromPath(pathname, "/interrupt")
        if (!key) return text("invalid session path", 400)

        const parsed = parseSessionKey(key)
        if (!parsed) return text("invalid session id", 400)

        try {
          if (parsed.kind === "local") {
            await manager.interrupt(parsed.id)
          } else {
            const remotes = await remoteManager.fetchAllSessions(false)
            const remoteSession = remotes.find((s) => s.remoteName === parsed.remoteName && s.id === parsed.id)
            if (!remoteSession) return text("remote session not found", 404)
            await remoteManager.interruptSession(remoteSession)
          }
          return json({ ok: true })
        } catch (error) {
          return text(error instanceof Error ? error.message : String(error), 400)
        }
      }

      return text("not found", 404)
    }
  })

  console.log(`Web UI: http://${options.host}:${options.port}`)
  console.log("Press Ctrl+C to stop")

  await new Promise<void>(() => {})
}
