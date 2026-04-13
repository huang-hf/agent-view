/**
 * Headless CLI command implementations
 * Reuses core session/storage logic without TUI
 */

import { getStorage } from "../core/storage"
import { SessionManager } from "../core/session"
import { isGitRepo, getRepoRoot, createWorktree, generateBranchName, generateWorktreePath, sanitizeBranchName, branchExists } from "../core/git"
import { getToolCommand } from "../core/types"
import type { Tool, Session, SessionStatus, ClaudeOptions } from "../core/types"
import type { NewOptions, ListOptions } from "./args"
import { existsSync } from "fs"
import path from "path"
import { NotifyRuntime, postWaitingEvent } from "../core/notify"
import { getConfig } from "../core/config"

const VALID_TOOLS = ["claude", "opencode", "gemini", "codex", "custom", "shell"]
const VALID_STATUSES = ["running", "waiting", "idle", "stopped", "error", "hibernated"]

function resolveSessionId(idOrTitle: string): string | null {
  const storage = getStorage()
  const sessions = storage.loadSessions()

  // Exact ID match
  const byId = sessions.find(s => s.id === idOrTitle)
  if (byId) return byId.id

  // Title match
  const byTitle = sessions.find(s => s.title === idOrTitle)
  if (byTitle) return byTitle.id

  // Prefix match on ID
  const byPrefix = sessions.filter(s => s.id.startsWith(idOrTitle))
  if (byPrefix.length === 1) return byPrefix[0]!.id

  return null
}

function formatRelativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function shortenPath(p: string): string {
  const home = process.env.HOME || ""
  if (home && p.startsWith(home)) {
    return "~" + p.slice(home.length)
  }
  return p
}

function statusColor(status: string): string {
  switch (status) {
    case "running": return "\x1b[32m"  // green
    case "waiting": return "\x1b[33m"  // yellow
    case "idle": return "\x1b[34m"     // blue
    case "error": return "\x1b[31m"    // red
    case "stopped": return "\x1b[90m"  // gray
    case "hibernated": return "\x1b[36m" // cyan
    default: return ""
  }
}

const RESET = "\x1b[0m"

export async function cmdNew(options: NewOptions): Promise<void> {
  // Initialize storage
  const storage = getStorage()

  // Validate tool
  if (!VALID_TOOLS.includes(options.tool)) {
    process.stderr.write(`Error: Invalid tool '${options.tool}'. Valid: ${VALID_TOOLS.join(", ")}\n`)
    process.exit(2)
  }

  // Expand ~ in path
  let projectPath = options.path
  if (projectPath.startsWith("~")) {
    projectPath = projectPath.replace("~", process.env.HOME || "")
  }

  // Resolve to absolute path
  projectPath = path.resolve(projectPath)

  // Validate path exists
  if (!existsSync(projectPath)) {
    process.stderr.write(`Error: Directory '${projectPath}' does not exist\n`)
    process.exit(3)
  }

  const tool = options.tool as Tool

  // Validate custom command
  if (tool === "custom" && !options.command) {
    process.stderr.write("Error: --command is required when --tool is 'custom'\n")
    process.exit(2)
  }

  // Handle worktree
  let worktreePath: string | undefined
  let worktreeRepo: string | undefined
  let worktreeBranch: string | undefined

  if (options.worktree) {
    if (!(await isGitRepo(projectPath))) {
      process.stderr.write(`Error: '${projectPath}' is not a git repository (required for --worktree)\n`)
      process.exit(3)
    }

    const repoRoot = await getRepoRoot(projectPath)
    const branchName = options.branch
      ? sanitizeBranchName(options.branch)
      : generateBranchName(options.title || undefined)

    let baseBranch: string | undefined
    if (options.baseDevelop) {
      if (await branchExists(repoRoot, "develop")) {
        baseBranch = "develop"
      } else {
        process.stderr.write("Warning: 'develop' branch not found, using HEAD\n")
      }
    }

    const wtPath = generateWorktreePath(repoRoot, branchName)
    process.stderr.write(`Creating worktree '${branchName}'...\n`)
    worktreePath = await createWorktree(repoRoot, branchName, wtPath, baseBranch)
    projectPath = worktreePath
    worktreeRepo = repoRoot
    worktreeBranch = branchName
  }

  // Build claude options
  let claudeOptions: ClaudeOptions | undefined
  if (tool === "claude" && (options.resume || options.skipPermissions)) {
    claudeOptions = {
      sessionMode: options.resume ? "resume" : "new",
      skipPermissions: options.skipPermissions,
    }
  }

  // Create session
  const manager = new SessionManager()
  const session = await manager.create({
    title: options.title,
    projectPath,
    groupPath: options.group || "my-sessions",
    tool,
    command: tool === "custom" ? options.command : undefined,
    worktreePath,
    worktreeRepo,
    worktreeBranch,
    claudeOptions,
  })

  // Output to stdout for scripting
  console.log(`Created session: ${session.title} (id: ${session.id})`)
  console.log(`Tmux session: ${session.tmuxSession}`)
  console.log(`Project: ${session.projectPath}`)
  if (worktreeBranch) {
    console.log(`Worktree branch: ${worktreeBranch}`)
  }
}

export async function cmdList(options: ListOptions): Promise<void> {
  const storage = getStorage()
  let sessions = storage.loadSessions()

  // Apply filters
  if (options.group) {
    sessions = sessions.filter(s => s.groupPath === options.group)
  }
  if (options.status) {
    if (!VALID_STATUSES.includes(options.status)) {
      process.stderr.write(`Error: Invalid status '${options.status}'. Valid: ${VALID_STATUSES.join(", ")}\n`)
      process.exit(2)
    }
    sessions = sessions.filter(s => s.status === options.status)
  }

  if (options.json) {
    console.log(JSON.stringify(sessions, null, 2))
    return
  }

  if (sessions.length === 0) {
    console.log("No sessions found.")
    return
  }

  // Table output
  const idWidth = 8
  const titleWidth = 16
  const statusWidth = 10
  const toolWidth = 10

  const header = [
    "ID".padEnd(idWidth),
    "TITLE".padEnd(titleWidth),
    "STATUS".padEnd(statusWidth),
    "TOOL".padEnd(toolWidth),
    "PROJECT",
  ].join("  ")

  console.log(header)

  for (const s of sessions) {
    const id = s.id.slice(0, 8)
    const title = s.title.length > titleWidth ? s.title.slice(0, titleWidth - 1) + "…" : s.title
    const color = statusColor(s.status)
    const line = [
      id.padEnd(idWidth),
      title.padEnd(titleWidth),
      `${color}${s.status.padEnd(statusWidth)}${RESET}`,
      s.tool.padEnd(toolWidth),
      shortenPath(s.projectPath),
    ].join("  ")
    console.log(line)
  }
}

export async function cmdDelete(id: string, worktree: boolean, force: boolean): Promise<void> {
  const storage = getStorage()
  const resolvedId = resolveSessionId(id)
  if (!resolvedId) {
    process.stderr.write(`Error: Session '${id}' not found\n`)
    process.exit(3)
  }

  const session = storage.getSession(resolvedId)
  if (!session) {
    process.stderr.write(`Error: Session '${id}' not found\n`)
    process.exit(3)
  }

  if (!force) {
    const label = worktree && session.worktreePath
      ? `Delete session '${session.title}' and its worktree?`
      : `Delete session '${session.title}'?`
    process.stderr.write(`${label} [y/N] `)

    const response = await new Promise<string>((resolve) => {
      let data = ""
      process.stdin.setEncoding("utf8")
      process.stdin.once("data", (chunk) => {
        data += chunk
        resolve(data.trim().toLowerCase())
      })
      // Handle non-interactive stdin (piped)
      process.stdin.once("end", () => resolve(""))
    })

    if (response !== "y" && response !== "yes") {
      process.stderr.write("Cancelled.\n")
      process.exit(0)
    }
  }

  const manager = new SessionManager()
  await manager.delete(resolvedId, { deleteWorktree: worktree })
  console.log(`Deleted session: ${session.title} (${resolvedId})`)
}

export async function cmdStop(id: string): Promise<void> {
  const resolvedId = resolveSessionId(id)
  if (!resolvedId) {
    process.stderr.write(`Error: Session '${id}' not found\n`)
    process.exit(3)
  }

  const manager = new SessionManager()
  const session = getStorage().getSession(resolvedId)
  await manager.stop(resolvedId)
  console.log(`Stopped session: ${session?.title || resolvedId}`)
}

export async function cmdRestart(id: string): Promise<void> {
  const resolvedId = resolveSessionId(id)
  if (!resolvedId) {
    process.stderr.write(`Error: Session '${id}' not found\n`)
    process.exit(3)
  }

  const manager = new SessionManager()
  const session = await manager.restart(resolvedId)
  console.log(`Restarted session: ${session.title} (${resolvedId})`)
  console.log(`Tmux session: ${session.tmuxSession}`)
}

export async function cmdAttach(id: string): Promise<void> {
  const resolvedId = resolveSessionId(id)
  if (!resolvedId) {
    process.stderr.write(`Error: Session '${id}' not found\n`)
    process.exit(3)
  }

  const manager = new SessionManager()
  manager.attach(resolvedId)
}

export async function cmdStatus(id: string): Promise<void> {
  const resolvedId = resolveSessionId(id)
  if (!resolvedId) {
    process.stderr.write(`Error: Session '${id}' not found\n`)
    process.exit(3)
  }

  const session = getStorage().getSession(resolvedId)
  if (!session) {
    process.stderr.write(`Error: Session '${id}' not found\n`)
    process.exit(3)
  }

  const color = statusColor(session.status)
  console.log(`Session: ${session.title} (${session.id})`)
  console.log(`Status: ${color}${session.status}${RESET}`)
  console.log(`Tool: ${session.tool}`)
  console.log(`Project: ${shortenPath(session.projectPath)}`)
  if (session.tmuxSession) {
    console.log(`Tmux: ${session.tmuxSession}`)
  }
  console.log(`Created: ${formatRelativeTime(session.createdAt)}`)
  console.log(`Last accessed: ${formatRelativeTime(session.lastAccessed)}`)
  if (session.worktreeBranch) {
    console.log(`Worktree: ${session.worktreeBranch}`)
  }
}

export async function cmdSend(id: string, message: string): Promise<void> {
  const resolvedId = resolveSessionId(id)
  if (!resolvedId) {
    process.stderr.write(`Error: Session '${id}' not found\n`)
    process.exit(3)
  }

  const session = getStorage().getSession(resolvedId)
  if (!session) {
    process.stderr.write(`Error: Session '${id}' not found\n`)
    process.exit(3)
  }

  if (!session.tmuxSession) {
    process.stderr.write(`Error: Session '${session.title}' has no tmux session\n`)
    process.exit(1)
  }

  if (session.status === "stopped") {
    process.stderr.write(`Error: Session '${session.title}' is stopped. Restart it first.\n`)
    process.exit(1)
  }

  const manager = new SessionManager()
  await manager.sendMessage(resolvedId, message)
  console.log(`Sent to ${session.title}: ${message.length > 80 ? message.slice(0, 80) + "..." : message}`)
}

export async function cmdConfirm(id: string): Promise<void> {
  const resolvedId = resolveSessionId(id)
  if (!resolvedId) {
    process.stderr.write(`Error: Session '${id}' not found\n`)
    process.exit(3)
  }

  const session = getStorage().getSession(resolvedId)
  if (!session) {
    process.stderr.write(`Error: Session '${id}' not found\n`)
    process.exit(3)
  }

  if (!session.tmuxSession) {
    process.stderr.write(`Error: Session '${session.title}' has no tmux session\n`)
    process.exit(1)
  }

  if (session.status === "stopped" || session.status === "hibernated") {
    process.stderr.write(`Error: Session '${session.title}' is ${session.status}. Restart it first.\n`)
    process.exit(1)
  }

  const manager = new SessionManager()
  await manager.confirm(resolvedId)
  console.log(`Confirmed session: ${session.title}`)
}

export async function cmdInterrupt(id: string): Promise<void> {
  const resolvedId = resolveSessionId(id)
  if (!resolvedId) {
    process.stderr.write(`Error: Session '${id}' not found\n`)
    process.exit(3)
  }

  const session = getStorage().getSession(resolvedId)
  if (!session) {
    process.stderr.write(`Error: Session '${id}' not found\n`)
    process.exit(3)
  }

  if (!session.tmuxSession) {
    process.stderr.write(`Error: Session '${session.title}' has no tmux session\n`)
    process.exit(1)
  }

  if (session.status === "stopped" || session.status === "hibernated") {
    process.stderr.write(`Error: Session '${session.title}' is ${session.status}. Restart it first.\n`)
    process.exit(1)
  }

  const manager = new SessionManager()
  await manager.interrupt(resolvedId)
  console.log(`Interrupted session: ${session.title} (Esc Esc)`)
}

export async function cmdOutput(id: string, lines: number): Promise<void> {
  const resolvedId = resolveSessionId(id)
  if (!resolvedId) {
    process.stderr.write(`Error: Session '${id}' not found\n`)
    process.exit(3)
  }

  const manager = new SessionManager()
  const output = await manager.getOutput(resolvedId, lines)
  process.stdout.write(output)
}

export async function cmdInfo(id: string, json: boolean): Promise<void> {
  const resolvedId = resolveSessionId(id)
  if (!resolvedId) {
    process.stderr.write(`Error: Session '${id}' not found\n`)
    process.exit(3)
  }

  const session = getStorage().getSession(resolvedId)
  if (!session) {
    process.stderr.write(`Error: Session '${id}' not found\n`)
    process.exit(3)
  }

  if (json) {
    console.log(JSON.stringify(session, null, 2))
    return
  }

  const color = statusColor(session.status)
  console.log(`ID:              ${session.id}`)
  console.log(`Title:           ${session.title}`)
  console.log(`Status:          ${color}${session.status}${RESET}`)
  console.log(`Tool:            ${session.tool}`)
  console.log(`Command:         ${session.command}`)
  console.log(`Project:         ${session.projectPath}`)
  console.log(`Group:           ${session.groupPath}`)
  console.log(`Tmux:            ${session.tmuxSession || "(none)"}`)
  console.log(`Created:         ${session.createdAt.toISOString()}`)
  console.log(`Last accessed:   ${session.lastAccessed.toISOString()}`)
  if (session.worktreePath) {
    console.log(`Worktree path:   ${session.worktreePath}`)
    console.log(`Worktree repo:   ${session.worktreeRepo}`)
    console.log(`Worktree branch: ${session.worktreeBranch}`)
  }
  if (session.parentSessionId) {
    console.log(`Parent session:  ${session.parentSessionId}`)
  }
}

export async function cmdHibernate(id: string): Promise<void> {
  const resolvedId = resolveSessionId(id)
  if (!resolvedId) {
    process.stderr.write(`Error: Session '${id}' not found\n`)
    process.exit(3)
  }

  const session = getStorage().getSession(resolvedId)
  if (!session) {
    process.stderr.write(`Error: Session '${id}' not found\n`)
    process.exit(3)
  }

  if (session.tool !== "claude" || !session.toolData?.claudeSessionId) {
    process.stderr.write(`Error: Only Claude sessions with a session ID can be hibernated\n`)
    process.exit(1)
  }

  const manager = new SessionManager()
  await manager.hibernate(resolvedId)
  console.log(`Hibernated session: ${session.title} (${resolvedId})`)
}

export async function cmdWake(id: string): Promise<void> {
  const resolvedId = resolveSessionId(id)
  if (!resolvedId) {
    process.stderr.write(`Error: Session '${id}' not found\n`)
    process.exit(3)
  }

  const session = getStorage().getSession(resolvedId)
  if (!session) {
    process.stderr.write(`Error: Session '${id}' not found\n`)
    process.exit(3)
  }

  if (session.status !== "hibernated") {
    process.stderr.write(`Error: Session '${session.title}' is not hibernated (status: ${session.status})\n`)
    process.exit(1)
  }

  const manager = new SessionManager()
  const resumed = await manager.resume(resolvedId)
  console.log(`Woke session: ${resumed.title} (${resolvedId})`)
  console.log(`Tmux session: ${resumed.tmuxSession}`)
}

export async function cmdAutoHibernate(minutes?: number): Promise<void> {
  const { loadConfig, saveConfig } = await import("../core/config")
  const config = await loadConfig()

  if (minutes === undefined) {
    const current = config.autoHibernateMinutes || 0
    if (current === 0) {
      console.log("Auto-hibernate: disabled")
    } else {
      console.log(`Auto-hibernate: ${current} minutes`)
    }
    return
  }

  await saveConfig({ ...config, autoHibernateMinutes: minutes, autoHibernatePrompted: true })
  if (minutes === 0) {
    console.log("Auto-hibernate disabled")
  } else {
    console.log(`Auto-hibernate set to ${minutes} minutes`)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function cmdRun(): Promise<void> {
  const { loadConfig } = await import("../core/config")
  await loadConfig()

  const config = getConfig()
  const notify = config.notify
  if (!notify?.enabled) {
    process.stderr.write("Error: notify.enabled is false in ~/.agent-view/config.json\n")
    process.exit(2)
  }
  if (!notify.webhookUrl) {
    process.stderr.write("Error: notify.webhookUrl is required in ~/.agent-view/config.json\n")
    process.exit(2)
  }

  const manager = new SessionManager()
  const runtime = new NotifyRuntime({
    cooldownSeconds: notify.cooldownSeconds ?? 300,
    tokenTtlSeconds: notify.tokenTtlSeconds ?? 300,
  })

  const actionPath = notify.actionServer?.path || "/notify/action"
  const actionHost = notify.actionServer?.host || "127.0.0.1"
  const actionPort = notify.actionServer?.port || 5177
  const actionSecret = notify.actionServer?.secretEnv
    ? process.env[notify.actionServer.secretEnv]
    : undefined

  let server: ReturnType<typeof Bun.serve> | null = null
  if (notify.actionServer?.enabled) {
    server = Bun.serve({
      hostname: actionHost,
      port: actionPort,
      async fetch(req) {
        if (new URL(req.url).pathname !== actionPath) {
          return new Response("not found", { status: 404 })
        }
        if (req.method !== "POST") {
          return new Response("method not allowed", { status: 405 })
        }

        if (actionSecret) {
          const provided = req.headers.get("x-av-secret") || ""
          if (provided !== actionSecret) {
            return Response.json({ ok: false, message: "unauthorized" }, { status: 401 })
          }
        }

        let body: { token?: string; action?: "yes" | "no" } = {}
        try {
          body = await req.json()
        } catch {
          return Response.json({ ok: false, message: "invalid json" }, { status: 400 })
        }
        if (!body.token || (body.action !== "yes" && body.action !== "no")) {
          return Response.json({ ok: false, message: "invalid payload" }, { status: 400 })
        }

        const result = await runtime.handleAction({
          token: body.token,
          action: body.action,
          sendYes: async (sessionId: string) => {
            await manager.sendMessage(sessionId, "yes")
          },
        })
        return Response.json(result, { status: result.ok ? 200 : 400 })
      },
    })
  }

  process.stdout.write("Notify watcher started\n")
  process.stdout.write(`Webhook: ${notify.webhookUrl}\n`)
  if (server) {
    process.stdout.write(`Action endpoint: http://${actionHost}:${actionPort}${actionPath}\n`)
  }

  let running = true
  const stop = () => {
    running = false
    server?.stop()
  }
  process.on("SIGINT", stop)
  process.on("SIGTERM", stop)

  const pollIntervalMs = notify.pollIntervalMs ?? 500
  while (running) {
    await manager.refreshStatuses()
    const sessions = getStorage().loadSessions()
    const events = runtime.collectWaitingEntries(sessions)
    for (const event of events) {
      await postWaitingEvent(notify, event)
    }
    await sleep(pollIntervalMs)
  }
}
