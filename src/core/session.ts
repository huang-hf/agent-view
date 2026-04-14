/**
 * Session lifecycle management
 * Combines storage and tmux operations
 */

import { getStorage } from "./storage"
import type { Session, SessionCreateOptions, SessionStatus, Tool, Recent } from "./types"
import { getToolCommand } from "./types"
import * as tmux from "./tmux"
import { removeWorktree } from "./git"
import { randomUUID } from "crypto"
import path from "path"
import fs from "fs"
import os from "os"
import { buildClaudeCommand } from "./claude"
import { getConfig, saveConfig } from "./config"
import { addRecent } from "./recents"
import { paginateTranscript, type TranscriptPageOptions } from "./transcript"

const logFile = path.join(os.homedir(), ".agent-orchestrator", "debug.log")
function log(...args: unknown[]) {
  const msg = `[${new Date().toISOString()}] [SESSION] ${args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ")}\n`
  try { fs.appendFileSync(logFile, msg) } catch {}
}

// Name generation patterns
const ADJECTIVES = [
  "swift", "bright", "calm", "deep", "eager", "fair", "gentle", "happy",
  "keen", "light", "mild", "noble", "proud", "quick", "rich", "safe",
  "true", "vivid", "warm", "wise", "bold", "cool", "dark", "fast"
]

const NOUNS = [
  "fox", "owl", "wolf", "bear", "hawk", "lion", "deer", "crow",
  "dove", "seal", "swan", "hare", "lynx", "moth", "newt", "orca",
  "pike", "rook", "toad", "vole", "wren", "yak", "bass", "crab"
]

function generateTitle(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
  return `${adj}-${noun}`
}

const LOCAL_WAITING_EXIT_GRACE_POLLS = 2
const CODEX_WAITING_STICKY_MS = 3000
const CODEX_WAITING_IGNORE_AFTER_CONFIRM_MS = 3000
const MAX_DEBUG_SNIPPET_LENGTH = 240

function deriveLocalSessionStatus(status: tmux.ToolStatus, isActive: boolean): SessionStatus {
  if (status.isWaiting) return "waiting"
  if (status.hasError) return "error"
  if (status.isBusy || isActive) return "running"
  return "idle"
}

function compactDebugSnippet(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .slice(-MAX_DEBUG_SNIPPET_LENGTH)
}

export function stabilizeWaitingTransition(
  previous: SessionStatus,
  candidate: SessionStatus,
  exitPolls: number
): { next: SessionStatus; exitPolls: number } {
  if (candidate === "waiting") {
    return { next: "waiting", exitPolls: 0 }
  }

  if (previous === "waiting" && (candidate === "idle" || candidate === "running")) {
    const nextExitPolls = exitPolls + 1
    if (nextExitPolls < LOCAL_WAITING_EXIT_GRACE_POLLS) {
      return { next: "waiting", exitPolls: nextExitPolls }
    }
  }
  return { next: candidate, exitPolls: 0 }
}

export function reconcileCodexWaitingCandidate(
  previous: SessionStatus,
  candidate: SessionStatus,
  lastSeenAt: number,
  ignoreUntil: number,
  now = Date.now()
): { candidate: SessionStatus; lastSeenAt: number } {
  if (ignoreUntil > now && candidate === "waiting") {
    return { candidate: "running", lastSeenAt }
  }
  if (candidate === "waiting") {
    return { candidate, lastSeenAt: now }
  }
  if (previous === "waiting" && lastSeenAt > 0 && now - lastSeenAt < CODEX_WAITING_STICKY_MS) {
    return { candidate: "waiting", lastSeenAt }
  }
  return { candidate, lastSeenAt: 0 }
}

export class SessionManager {
  private refreshInterval: NodeJS.Timeout | null = null
  private refreshInFlight = false
  private memoryMap = new Map<string, number>() // sessionId → KB
  private _recentAutoHibernated: { id: string; title: string; idleMinutes: number }[] = []
  private localWaitingExitPolls = new Map<string, number>() // sessionId -> consecutive non-waiting polls
  private codexWaitingSeenAt = new Map<string, number>() // sessionId -> last waiting seen timestamp
  private codexWaitingIgnoreUntil = new Map<string, number>() // sessionId -> ignore waiting until timestamp

  private stabilizeLocalWaitingStatus(
    session: Session,
    candidate: SessionStatus
  ): SessionStatus {
    if (session.tool === "codex") {
      const now = Date.now()
      const seenAt = this.codexWaitingSeenAt.get(session.id) || 0
      const ignoreUntil = this.codexWaitingIgnoreUntil.get(session.id) || 0
      const codex = reconcileCodexWaitingCandidate(session.status, candidate, seenAt, ignoreUntil, now)
      candidate = codex.candidate
      if (codex.lastSeenAt > 0) this.codexWaitingSeenAt.set(session.id, codex.lastSeenAt)
      else this.codexWaitingSeenAt.delete(session.id)
      if (ignoreUntil > 0 && ignoreUntil <= now) this.codexWaitingIgnoreUntil.delete(session.id)
    }

    const exitPolls = this.localWaitingExitPolls.get(session.id) || 0
    const resolved = stabilizeWaitingTransition(session.status, candidate, exitPolls)
    if (resolved.exitPolls > 0) this.localWaitingExitPolls.set(session.id, resolved.exitPolls)
    else this.localWaitingExitPolls.delete(session.id)
    return resolved.next
  }

  getMemoryKB(sessionId: string): number | undefined {
    return this.memoryMap.get(sessionId)
  }

  drainAutoHibernated(): { id: string; title: string; idleMinutes: number }[] {
    const items = this._recentAutoHibernated
    this._recentAutoHibernated = []
    return items
  }

  startRefreshLoop(intervalMs = 500): void {
    if (this.refreshInterval) return

    this.refreshInterval = setInterval(async () => {
      if (this.refreshInFlight) return
      this.refreshInFlight = true
      try {
        await this.refreshStatuses()
      } finally {
        this.refreshInFlight = false
      }
    }, intervalMs)
  }

  stopRefreshLoop(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval)
      this.refreshInterval = null
    }
    this.refreshInFlight = false
  }

  async refreshStatuses(): Promise<void> {
    await tmux.refreshSessionCache()

    const storage = getStorage()
    const sessions = storage.loadSessions()

    const config = getConfig()
    const autoHibernateMs = (config.autoHibernateMinutes || 0) * 60 * 1000

    for (const session of sessions) {
      if (!session.tmuxSession) continue

      // Skip hibernated sessions — they have no tmux process
      if (session.status === "hibernated") continue

      const exists = tmux.sessionExists(session.tmuxSession)
      if (!exists) {
        // Session was killed externally
        storage.writeStatus(session.id, "stopped", session.tool)
        continue
      }

      const isActive = tmux.isSessionActive(session.tmuxSession, 2)

      // Always capture output and check patterns - not just when active
      // This fixes the bug where waiting sessions were incorrectly marked as idle
      try {
        // Don't use endLine - Claude Code TUI may have blank lines at bottom
        // which causes -E -1 to capture mostly empty content
        const output = await tmux.capturePane(session.tmuxSession, {
          startLine: -100
        })
        const statusDebug = tmux.parseToolStatusDebug(output, session.tool)
        const status: tmux.ToolStatus = statusDebug

        const candidate = deriveLocalSessionStatus(status, isActive)
        const next = this.stabilizeLocalWaitingStatus(session, candidate)
        if (session.tool === "codex" && (session.status !== next || candidate === "waiting" || next === "waiting")) {
          log("local status decision", {
            sessionId: session.id,
            title: session.title,
            tmuxSession: session.tmuxSession,
            previous: session.status,
            candidate,
            next,
            isActive,
            isWaiting: status.isWaiting,
            isBusy: status.isBusy,
            hasError: status.hasError,
            waitingReason: statusDebug.waitingReason,
            errorReason: statusDebug.errorReason,
            ignoreUntil: this.codexWaitingIgnoreUntil.get(session.id) || 0,
            seenAt: this.codexWaitingSeenAt.get(session.id) || 0,
            exitPolls: this.localWaitingExitPolls.get(session.id) || 0,
            snippet: compactDebugSnippet(output)
          })
        }
        storage.writeStatus(session.id, next, session.tool)

        if (next === "idle") {
          // No recent activity and no waiting prompt - idle
          // Auto-hibernate: if idle too long, hibernate Claude sessions
          if (autoHibernateMs > 0 && session.tool === "claude" && session.toolData?.claudeSessionId) {
            const lastActivity = tmux.getSessionActivity(session.tmuxSession)
            if (lastActivity > 0) {
              const idleMs = Date.now() - lastActivity * 1000
              if (idleMs >= autoHibernateMs) {
                try {
                  await this.hibernate(session.id)
                  this._recentAutoHibernated.push({
                    id: session.id,
                    title: session.title,
                    idleMinutes: Math.round(idleMs / 60000)
                  })
                } catch {
                  // Ignore hibernate failures during auto-hibernate
                }
              }
            }
          }
        }
      } catch {
        // Fallback: use activity-based detection if capture fails
        storage.writeStatus(session.id, isActive ? "running" : "idle", session.tool)
      }
    }

    storage.touch()

    // Collect memory usage for all running sessions
    const tmuxNames = sessions
      .filter((s): s is Session & { tmuxSession: string } => !!s.tmuxSession && tmux.sessionExists(s.tmuxSession))
      .map(s => s.tmuxSession)
    const memMap = await tmux.getSessionsMemoryKB(tmuxNames)
    for (const session of sessions) {
      if (session.tmuxSession && memMap.has(session.tmuxSession)) {
        this.memoryMap.set(session.id, memMap.get(session.tmuxSession)!)
      } else {
        this.memoryMap.delete(session.id)
      }
    }
  }

  async create(options: SessionCreateOptions): Promise<Session> {
    log("create() called with options:", options)
    const storage = getStorage()
    const now = new Date()

    const title = options.title || generateTitle()
    const id = randomUUID()
    const tmuxName = tmux.generateSessionName(title)

    // Generate Claude session ID for new Claude sessions (not forks/resumes)
    // This allows us to track the session ID for forking later
    let claudeSessionId: string | null = null
    const isNewClaudeSession = options.tool === "claude" &&
      !options.command && // No custom command (fork uses custom command)
      (!options.claudeOptions || options.claudeOptions.sessionMode === "new")

    if (isNewClaudeSession) {
      claudeSessionId = randomUUID()
      log("Generated Claude session ID:", claudeSessionId)
    }

    // Determine command - handle Claude options for resume
    let command: string
    if (options.command) {
      command = options.command
    } else if (options.tool === "claude" && claudeSessionId) {
      // New Claude session with our generated session ID
      const baseCommand = buildClaudeCommand(options.claudeOptions)
      command = `${baseCommand} --session-id "${claudeSessionId}"`
    } else if (options.tool === "claude" && options.claudeOptions) {
      command = buildClaudeCommand(options.claudeOptions)
    } else {
      command = getToolCommand(options.tool)
    }

    log("Creating tmux session:", tmuxName, "command:", command)

    // Build environment variables
    const env: Record<string, string> = {
      AGENT_ORCHESTRATOR_SESSION: id
    }
    if (claudeSessionId) {
      env.CLAUDE_SESSION_ID = claudeSessionId
    }

    try {
      await tmux.createSession({
        name: tmuxName,
        command,
        cwd: options.projectPath,
        env,
        windowTitle: title
      })
      log("tmux session created successfully")
    } catch (err) {
      log("tmux.createSession error:", err)
      throw err
    }

    const toolData: Record<string, unknown> = {}
    if (options.tool === "claude" && options.claudeOptions) {
      toolData.claudeSessionMode = options.claudeOptions.sessionMode
    }
    if (claudeSessionId) {
      toolData.claudeSessionId = claudeSessionId
    }

    const session: Session = {
      id,
      title,
      projectPath: options.projectPath,
      groupPath: options.groupPath || "my-sessions",
      order: storage.loadSessions().length,
      command,
      wrapper: options.wrapper || "",
      tool: options.tool,
      status: "running",
      tmuxSession: tmuxName,
      createdAt: now,
      lastAccessed: now,
      parentSessionId: options.parentSessionId || "",
      worktreePath: options.worktreePath || "",
      worktreeRepo: options.worktreeRepo || "",
      worktreeBranch: options.worktreeBranch || "",
      toolData,
      acknowledged: false
    }

    storage.saveSession(session)
    storage.touch()

    // Auto-save as recent for future quick access
    await this.saveRecent(options)

    return session
  }

  private async saveRecent(options: SessionCreateOptions): Promise<void> {
    const config = getConfig()

    const newRecent: Recent = {
      name: options.title || "untitled",
      projectPath: options.projectPath,
      tool: options.tool,
      groupPath: options.groupPath
    }

    const recents = addRecent(config.recents || [], newRecent)
    await saveConfig({ ...config, recents })
  }

  async delete(sessionId: string, options?: { deleteWorktree?: boolean }): Promise<void> {
    const storage = getStorage()
    const session = storage.getSession(sessionId)

    if (session?.tmuxSession) {
      await tmux.killSession(session.tmuxSession)
    }

    if (options?.deleteWorktree && session?.worktreePath && session?.worktreeRepo) {
      try {
        await removeWorktree(session.worktreeRepo, session.worktreePath, true)
      } catch {
        // Worktree may already be removed
      }
    }

    storage.deleteSession(sessionId)
    storage.touch()
  }

  async resume(sessionId: string): Promise<Session> {
    const storage = getStorage()
    const session = storage.getSession(sessionId)

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    if (session.tmuxSession) {
      await tmux.killSession(session.tmuxSession)
    }

    // For Claude sessions with a claudeSessionId, resume the existing conversation
    const claudeSessionId = session.tool === "claude" && session.toolData?.claudeSessionId
      ? (session.toolData.claudeSessionId as string)
      : undefined

    const command = claudeSessionId
      ? `claude --resume ${claudeSessionId}`
      : session.command

    const env: Record<string, string> = { AGENT_ORCHESTRATOR_SESSION: session.id }
    if (claudeSessionId) {
      env.CLAUDE_SESSION_ID = claudeSessionId
    }

    const newTmuxName = tmux.generateSessionName(session.title)
    await tmux.createSession({
      name: newTmuxName,
      command,
      cwd: session.projectPath,
      env
    })

    session.tmuxSession = newTmuxName
    session.command = command
    session.status = "running"
    session.lastAccessed = new Date()

    storage.saveSession(session)
    storage.touch()

    return session
  }

  async restart(sessionId: string): Promise<Session> {
    const storage = getStorage()
    const session = storage.getSession(sessionId)

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    if (session.tmuxSession) {
      await tmux.killSession(session.tmuxSession)
    }

    // For Claude sessions, generate a fresh session ID to avoid reuse conflicts
    const isClaudeSession = session.tool === "claude" && session.toolData?.claudeSessionId
    const newClaudeSessionId = isClaudeSession ? randomUUID() : undefined
    const command = isClaudeSession
      ? `claude --session-id "${newClaudeSessionId}"`
      : session.command

    const env: Record<string, string> = { AGENT_ORCHESTRATOR_SESSION: session.id }
    if (newClaudeSessionId) {
      env.CLAUDE_SESSION_ID = newClaudeSessionId
    }

    const newTmuxName = tmux.generateSessionName(session.title)
    await tmux.createSession({
      name: newTmuxName,
      command,
      cwd: session.projectPath,
      env
    })

    session.tmuxSession = newTmuxName
    session.command = command
    session.status = "running"
    session.lastAccessed = new Date()
    if (newClaudeSessionId) {
      session.toolData = { ...session.toolData, claudeSessionId: newClaudeSessionId }
    }

    storage.saveSession(session)
    storage.touch()

    return session
  }

  /**
   * Stop a session (kill tmux but keep record)
   */
  async stop(sessionId: string): Promise<void> {
    const storage = getStorage()
    const session = storage.getSession(sessionId)

    if (!session) return

    if (session.tmuxSession) {
      await tmux.killSession(session.tmuxSession)
    }

    storage.writeStatus(sessionId, "stopped", session.tool)
    storage.touch()
  }

  /**
   * Hibernate a session (kill tmux to free memory, keep record for resume)
   * Only works for Claude sessions with a claudeSessionId.
   */
  async hibernate(sessionId: string): Promise<void> {
    const storage = getStorage()
    const session = storage.getSession(sessionId)

    if (!session) return

    if (session.tool !== "claude" || !session.toolData?.claudeSessionId) {
      throw new Error("Only Claude sessions with a session ID can be hibernated")
    }

    if (session.tmuxSession) {
      await tmux.killSession(session.tmuxSession)
    }

    storage.writeStatus(sessionId, "hibernated", session.tool)
    storage.touch()
  }

  async sendMessage(sessionId: string, message: string): Promise<void> {
    const storage = getStorage()
    const session = storage.getSession(sessionId)

    if (!session?.tmuxSession) {
      throw new Error(`Session not found or not running: ${sessionId}`)
    }

    await tmux.sendKeys(session.tmuxSession, message)
    storage.updateSessionField(sessionId, "last_accessed", Date.now())
  }

  async confirmWaiting(sessionId: string, message: string): Promise<void> {
    const storage = getStorage()
    const before = storage.getSession(sessionId)
    await this.sendMessage(sessionId, message)
    if (before?.status === "waiting") {
      if (before.tool === "codex") {
        this.codexWaitingSeenAt.delete(sessionId)
        this.codexWaitingIgnoreUntil.set(
          sessionId,
          Date.now() + CODEX_WAITING_IGNORE_AFTER_CONFIRM_MS
        )
      }
      storage.writeStatus(sessionId, "running", before.tool)
      storage.touch()
    }
  }

  async confirm(sessionId: string): Promise<void> {
    const storage = getStorage()
    const session = storage.getSession(sessionId)

    if (!session?.tmuxSession) {
      throw new Error(`Session not found or not running: ${sessionId}`)
    }

    await tmux.sendKeys(session.tmuxSession, "")
    storage.setAcknowledged(sessionId, true)
    storage.updateSessionField(sessionId, "last_accessed", Date.now())
    storage.touch()
  }

  async interrupt(sessionId: string): Promise<void> {
    const storage = getStorage()
    const session = storage.getSession(sessionId)

    if (!session?.tmuxSession) {
      throw new Error(`Session not found or not running: ${sessionId}`)
    }

    await tmux.sendEscapeTwice(session.tmuxSession)
    storage.updateSessionField(sessionId, "last_accessed", Date.now())
    storage.touch()
  }

  async getOutput(sessionId: string, lines = 100): Promise<string> {
    const storage = getStorage()
    const session = storage.getSession(sessionId)

    if (!session?.tmuxSession) {
      return ""
    }

    try {
      return await tmux.capturePane(session.tmuxSession, {
        startLine: -lines,
        escape: true,
        join: true
      })
    } catch {
      return ""
    }
  }

  async getOutputPage(
    sessionId: string,
    options: TranscriptPageOptions = {}
  ): Promise<{ text: string; lines: string[]; nextBefore: number; hasMore: boolean; total: number }> {
    const storage = getStorage()
    const session = storage.getSession(sessionId)
    if (!session?.tmuxSession) {
      return { text: "", lines: [], nextBefore: 0, hasMore: false, total: 0 }
    }

    const maxLines = Math.max(1, options.maxLines ?? 1000)

    try {
      const output = await tmux.capturePane(session.tmuxSession, {
        startLine: -maxLines,
        join: true
      })
      const rawLines = output.split("\n")

      while (rawLines.length > 0 && rawLines[rawLines.length - 1]?.trim() === "") {
        rawLines.pop()
      }

      const page = paginateTranscript(rawLines, options)
      return {
        text: page.lines.join("\n"),
        lines: page.lines,
        nextBefore: page.nextBefore,
        hasMore: page.hasMore,
        total: page.total
      }
    } catch {
      return { text: "", lines: [], nextBefore: 0, hasMore: false, total: 0 }
    }
  }

  /**
   * Attach to a session (takes over terminal)
   */
  attach(sessionId: string): void {
    const storage = getStorage()
    const session = storage.getSession(sessionId)

    if (!session?.tmuxSession) {
      throw new Error(`Session not found or not running: ${sessionId}`)
    }

    tmux.attachSession(session.tmuxSession)
  }

  list(): Session[] {
    return getStorage().loadSessions()
  }

  get(sessionId: string): Session | null {
    return getStorage().getSession(sessionId)
  }

  async updateTitle(sessionId: string, title: string): Promise<void> {
    const storage = getStorage()
    const session = storage.getSession(sessionId)

    // Update title in storage
    storage.updateSessionField(sessionId, "title", title)

    // Also rename tmux window to show the new title (keep session name for internal tracking)
    if (session?.tmuxSession) {
      await tmux.renameWindow(session.tmuxSession, title)
    }

    storage.touch()
  }

  moveToGroup(sessionId: string, groupPath: string): void {
    const storage = getStorage()
    storage.updateSessionField(sessionId, "group_path", groupPath)
    storage.touch()
  }

  acknowledge(sessionId: string): void {
    const storage = getStorage()
    storage.setAcknowledged(sessionId, true)
    storage.touch()
  }

  groupByStatus(): {
    running: Session[]
    waiting: Session[]
    idle: Session[]
    stopped: Session[]
    error: Session[]
    hibernated: Session[]
  } {
    const sessions = this.list()
    return {
      running: sessions.filter((s) => s.status === "running"),
      waiting: sessions.filter((s) => s.status === "waiting"),
      idle: sessions.filter((s) => s.status === "idle"),
      stopped: sessions.filter((s) => s.status === "stopped"),
      error: sessions.filter((s) => s.status === "error"),
      hibernated: sessions.filter((s) => s.status === "hibernated")
    }
  }

  groupByPath(): Map<string, Session[]> {
    const sessions = this.list()
    const groups = new Map<string, Session[]>()

    for (const session of sessions) {
      const existing = groups.get(session.groupPath) || []
      existing.push(session)
      groups.set(session.groupPath, existing)
    }

    return groups
  }
}

// Singleton instance
let sessionManager: SessionManager | null = null

export function getSessionManager(): SessionManager {
  if (!sessionManager) {
    sessionManager = new SessionManager()
  }
  return sessionManager
}
