import { randomUUID } from "crypto"
import type { Session, SessionStatus } from "./types"
import type { NotifyConfig } from "./config"

type NotifyAction = "yes" | "no"

interface PendingAction {
  token: string
  sessionId: string
  createdAt: number
  expiresAt: number
  handled: boolean
}

export interface WaitingEvent {
  eventId: string
  actionToken: string
  timestamp: string
  sessionId: string
  title: string
  status: SessionStatus
  tool: string
  groupPath: string
  projectPath: string
  remoteHost: string
}

export interface NotifyRuntimeOptions {
  cooldownSeconds?: number
  tokenTtlSeconds?: number
}

export interface HandleActionInput {
  token: string
  action: NotifyAction
  sendYes: (sessionId: string) => Promise<void>
}

export interface HandleActionResult {
  ok: boolean
  message: string
  sessionId?: string
}

export class NotifyRuntime {
  private previousStatuses = new Map<string, SessionStatus>()
  private cooldownUntil = new Map<string, number>()
  private pendingActions = new Map<string, PendingAction>()
  private readonly cooldownSeconds: number
  private readonly tokenTtlSeconds: number

  constructor(options: NotifyRuntimeOptions = {}) {
    this.cooldownSeconds = options.cooldownSeconds ?? 300
    this.tokenTtlSeconds = options.tokenTtlSeconds ?? 300
  }

  collectWaitingEntries(sessions: Session[], nowMs = Date.now()): WaitingEvent[] {
    const events: WaitingEvent[] = []
    const currentIds = new Set<string>()

    for (const session of sessions) {
      currentIds.add(session.id)
      const previous = this.previousStatuses.get(session.id)
      const enteringWaiting = previous !== "waiting" && session.status === "waiting"
      const cooldownEndsAt = this.cooldownUntil.get(session.id) ?? 0

      if (enteringWaiting && nowMs >= cooldownEndsAt) {
        const actionToken = randomUUID()
        const event: WaitingEvent = {
          eventId: randomUUID(),
          actionToken,
          timestamp: new Date(nowMs).toISOString(),
          sessionId: session.id,
          title: session.title,
          status: session.status,
          tool: session.tool,
          groupPath: session.groupPath,
          projectPath: session.projectPath,
          remoteHost: session.remoteHost,
        }
        events.push(event)
        this.cooldownUntil.set(session.id, nowMs + this.cooldownSeconds * 1000)
        this.pendingActions.set(actionToken, {
          token: actionToken,
          sessionId: session.id,
          createdAt: nowMs,
          expiresAt: nowMs + this.tokenTtlSeconds * 1000,
          handled: false,
        })
      }

      this.previousStatuses.set(session.id, session.status)
    }

    for (const id of this.previousStatuses.keys()) {
      if (!currentIds.has(id)) {
        this.previousStatuses.delete(id)
        this.cooldownUntil.delete(id)
      }
    }

    for (const [token, pending] of this.pendingActions.entries()) {
      if (pending.expiresAt <= nowMs || pending.handled) {
        this.pendingActions.delete(token)
      }
    }

    return events
  }

  async handleAction(input: HandleActionInput, nowMs = Date.now()): Promise<HandleActionResult> {
    const pending = this.pendingActions.get(input.token)
    if (!pending) {
      return { ok: false, message: "invalid token" }
    }
    if (pending.handled) {
      return { ok: false, message: "token already handled", sessionId: pending.sessionId }
    }
    if (pending.expiresAt <= nowMs) {
      this.pendingActions.delete(input.token)
      return { ok: false, message: "token expired", sessionId: pending.sessionId }
    }

    if (input.action === "yes") {
      await input.sendYes(pending.sessionId)
    }

    pending.handled = true
    this.pendingActions.set(input.token, pending)
    return { ok: true, message: "ok", sessionId: pending.sessionId }
  }
}

export async function postWaitingEvent(
  config: NotifyConfig,
  event: WaitingEvent,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  if (!config.webhookUrl) return false

  const headers: Record<string, string> = {
    "content-type": "application/json",
  }

  if (config.webhookTokenEnv) {
    const token = process.env[config.webhookTokenEnv]
    if (token) {
      headers.authorization = `Bearer ${token}`
    }
  }

  try {
    const res = await fetchImpl(config.webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        event: "session.waiting",
        data: event,
      }),
    })
    return res.ok
  } catch {
    return false
  }
}
