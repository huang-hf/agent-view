/**
 * Session lifecycle management
 * Combines storage and tmux operations
 */

import { getStorage } from "./storage"
import type { Session, SessionCreateOptions, SessionStatus, Tool, Recent } from "./types"
import { getToolCommand } from "./types"
import * as tmux from "./tmux"
import { localExecutor, type TmuxExecutor } from "./tmux"
import { getSshManager, SshTmuxExecutor } from "./ssh"
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

function deriveLocalSessionStatus(status: tmux.ToolStatus, isActive: boolean): SessionStatus {
  if (status.isWaiting) return "waiting"
  if (status.hasError) return "error"
  if (status.isBusy || isActive) return "running"
  return "idle"
}

function stabilizeWaitingTransition(
  previous: SessionStatus,
  candidate: SessionStatus,
  polls: number,
  gracePolls = LOCAL_WAITING_EXIT_GRACE_POLLS
): { next: SessionStatus; polls: number } {
  if (candidate === "waiting") {
    return { next: "waiting", polls: 0 }
  }
  if (previous === "waiting" && (candidate === "idle" || candidate === "running")) {
    const nextPolls = polls + 1
    if (nextPolls < gracePolls) {
      return { next: "waiting", polls: nextPolls }
    }
  }
  return { next: candidate, polls: 0 }
}

export class SessionManager {
  private refreshInterval: NodeJS.Timeout | null = null
  private refreshInFlight = false
  private memoryMap = new Map<string, number>() // sessionId → KB
  private _recentAutoHibernated: { id: string; title: string; idleMinutes: number }[] = []
  private localWaitingExitPolls = new Map<string, number>() // sessionId -> consecutive non-waiting polls

  private stabilizeLocalWaitingStatus(
    sessionId: string,
    previous: SessionStatus,
    candidate: SessionStatus
  ): SessionStatus {
    const currentPolls = this.localWaitingExitPolls.get(sessionId) || 0
    const resolved = stabilizeWaitingTransition(previous, candidate, currentPolls)
    if (resolved.polls > 0) this.localWaitingExitPolls.set(sessionId, resolved.polls)
    else this.localWaitingExitPolls.delete(sessionId)
    return resolved.next
  }

  private remoteSessionCaches = new Map<string, Set<string>>() // host -> session names
  private reconnectingHosts = new Set<string>() // hosts with in-progress reconnect

  private executorCache = new Map<string, TmuxExecutor>()

  private getExecutor(remoteHost: string): TmuxExecutor {
    if (!remoteHost) return localExecutor
    const cached = this.executorCache.get(remoteHost)
    if (cached) return cached
    const executor = new SshTmuxExecutor(remoteHost, getSshManager())
    this.executorCache.set(remoteHost, executor)
    return executor
  }

  private updateRemoteCache(host: string, stdout: string): void {
    const names = new Set<string>()
    for (const line of stdout.trim().split("\n")) {
      if (!line) continue
      const [name] = line.replace(/^"/, "").split("\t")
      if (name) names.add(name)
    }
    this.remoteSessionCaches.set(host, names)
  }

  remoteSessionExists(host: string, name: string): boolean {
    return this.remoteSessionCaches.get(host)?.has(name) ?? false
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
    const storage = getStorage()
    const sessions = storage.loadSessions()

    const localSessions = sessions.filter(s => !s.remoteHost)
    const remoteSessions = sessions.filter(s => !!s.remoteHost)

    // --- Local sessions (existing logic) ---
    await tmux.refreshSessionCache()

    const config = getConfig()
    const autoHibernateMs = (config.autoHibernateMinutes || 0) * 60 * 1000

    for (const session of localSessions) {
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
        const status = tmux.parseToolStatus(output, session.tool)

        const candidate = deriveLocalSessionStatus(status, isActive)
        const next = this.stabilizeLocalWaitingStatus(session.id, session.status, candidate)
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

    // --- Remote sessions ---
    const remoteHosts = new Set(remoteSessions.map(s => s.remoteHost))

    for (const host of remoteHosts) {
      const hostSessions = remoteSessions.filter(s => s.remoteHost === host)
      const manager = getSshManager()

      // Verify SSH connection is alive
      const alive = await manager.check(host)
      if (!alive) {
        // Trigger background reconnect (only one attempt at a time per host)
        if (!this.reconnectingHosts.has(host)) {
          this.reconnectingHosts.add(host)
          manager.connect(host).then(() => {
            log("Auto-reconnected SSH for host:", host)
          }).catch((err) => {
            log("Auto-reconnect failed for host:", host, err)
          }).finally(() => {
            this.reconnectingHosts.delete(host)
          })
        }
        // Preserve current statuses — don't flip to "offline" on transient failures.
        // Sessions will be updated on the next successful poll cycle.
        continue
      }

      const executor = this.getExecutor(host)

      // Refresh remote session cache
      try {
        const stdout = await executor.exec([
          "list-windows", "-a", "-F", "#{session_name}\t#{window_activity}"
        ])
        this.updateRemoteCache(host, stdout)
      } catch (err) {
        log("list-windows failed for host:", host, err)
        // Don't overwrite status — preserve current status on transient failure
        continue
      }

      // Poll each remote session
      for (const session of hostSessions) {
        if (!session.tmuxSession) continue
        if (session.status === "hibernated") continue

        if (!this.remoteSessionExists(host, session.tmuxSession)) {
          storage.writeStatus(session.id, "stopped", session.tool)
          continue
        }

        try {
          const output = await executor.exec([
            "capture-pane", "-t", session.tmuxSession, "-p", "-S", "-100"
          ])
          const status = tmux.parseToolStatus(output, session.tool)

          if (status.isWaiting) {
            storage.writeStatus(session.id, "waiting", session.tool)
          } else if (status.hasError) {
            storage.writeStatus(session.id, "error", session.tool)
          } else if (status.isBusy) {
            storage.writeStatus(session.id, "running", session.tool)
          } else {
            storage.writeStatus(session.id, "idle", session.tool)
          }
        } catch (err) {
          log("capture-pane failed for session:", session.id, "host:", host, err)
          // Don't overwrite status — preserve current status on transient failure
        }
      }
    }

    storage.touch()

    // Collect memory usage for local running sessions only
    const tmuxNames = localSessions
      .filter((s): s is Session & { tmuxSession: string } => !!s.tmuxSession && tmux.sessionExists(s.tmuxSession))
      .map(s => s.tmuxSession)
    const memMap = await tmux.getSessionsMemoryKB(tmuxNames)
    for (const session of localSessions) {
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

    // Generate Claude session ID for new Claude sessions (not resumes)
    // This allows us to track the session ID for resuming or hibernating later
    let claudeSessionId: string | null = null
    const isNewClaudeSession = options.tool === "claude" &&
      !options.command && // No custom command
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
      if (options.remoteHost) {
        // Remote session: create via SSH executor.
        // Pass command directly to new-session to avoid send-keys -l which
        // requires a tmux client and fails on detached-only servers.
        const executor = this.getExecutor(options.remoteHost)
        const newSessionArgs = [
          "new-session", "-d", "-s", tmuxName, "-c", options.projectPath
        ]
        if (command) newSessionArgs.push(command)
        await executor.exec(newSessionArgs)
      } else {
        await tmux.createSession({
          name: tmuxName,
          command,
          cwd: options.projectPath,
          env,
          windowTitle: title
        })
      }
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
      acknowledged: false,
      remoteHost: options.remoteHost || ""
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
      if (session.remoteHost) {
        const executor = this.getExecutor(session.remoteHost)
        await executor.exec(["kill-session", "-t", session.tmuxSession]).catch(() => {})
      } else {
        await tmux.killSession(session.tmuxSession)
      }
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
      if (session.remoteHost) {
        const executor = this.getExecutor(session.remoteHost)
        await executor.exec(["kill-session", "-t", session.tmuxSession]).catch(() => {})
      } else {
        await tmux.killSession(session.tmuxSession)
      }
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
    if (session.remoteHost) {
      const executor = this.getExecutor(session.remoteHost)
      const args = ["new-session", "-d", "-s", newTmuxName, "-c", session.projectPath]
      if (command) args.push(command)
      await executor.exec(args)
    } else {
      await tmux.createSession({ name: newTmuxName, command, cwd: session.projectPath, env })
    }

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
      if (session.remoteHost) {
        const executor = this.getExecutor(session.remoteHost)
        await executor.exec(["kill-session", "-t", session.tmuxSession]).catch(() => {})
      } else {
        await tmux.killSession(session.tmuxSession)
      }
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
    if (session.remoteHost) {
      const executor = this.getExecutor(session.remoteHost)
      const args = ["new-session", "-d", "-s", newTmuxName, "-c", session.projectPath]
      if (command) args.push(command)
      await executor.exec(args)
    } else {
      await tmux.createSession({ name: newTmuxName, command, cwd: session.projectPath, env })
    }

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
      if (session.remoteHost) {
        const executor = this.getExecutor(session.remoteHost)
        await executor.exec(["kill-session", "-t", session.tmuxSession]).catch(() => {})
      } else {
        await tmux.killSession(session.tmuxSession)
      }
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

    if (session.remoteHost) {
      // Ensure SSH connection is alive before sending
      const manager = getSshManager()
      const alive = await manager.check(session.remoteHost)
      log("sendMessage remote: host=", session.remoteHost, "alive=", alive, "tmux=", session.tmuxSession)
      if (!alive) {
        log("sendMessage: reconnecting SSH...")
        await manager.connect(session.remoteHost)
      }
      const executor = this.getExecutor(session.remoteHost)
      const args = ["send-keys", "-t", session.tmuxSession]
      if (message) args.push("-l", message)
      args.push("Enter")
      log("sendMessage: exec args=", args)
      await executor.exec(args)
      log("sendMessage: exec done")
    } else {
      await tmux.sendKeys(session.tmuxSession, message)
    }
    storage.updateSessionField(sessionId, "last_accessed", Date.now())
  }

  async confirmWaiting(sessionId: string, message: string): Promise<void> {
    const storage = getStorage()
    const before = storage.getSession(sessionId)
    await this.sendMessage(sessionId, message)
    if (before?.status === "waiting") {
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
      if (session.remoteHost) {
        const executor = this.getExecutor(session.remoteHost)
        return await executor.exec([
          "capture-pane", "-t", session.tmuxSession, "-p", "-S", String(-lines)
        ])
      }
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

    log("attach() sessionId:", sessionId, "tmuxSession:", session.tmuxSession, "remoteHost:", session.remoteHost)
    const executor = this.getExecutor(session.remoteHost)
    executor.spawnAttach(session.tmuxSession)
    log("attach() returned from spawnAttach")
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
    offline: Session[]
  } {
    const sessions = this.list()
    return {
      running: sessions.filter((s) => s.status === "running"),
      waiting: sessions.filter((s) => s.status === "waiting"),
      idle: sessions.filter((s) => s.status === "idle"),
      stopped: sessions.filter((s) => s.status === "stopped"),
      error: sessions.filter((s) => s.status === "error"),
      hibernated: sessions.filter((s) => s.status === "hibernated"),
      offline: sessions.filter((s) => s.status === "offline")
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
