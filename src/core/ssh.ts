/**
 * SSH runner for executing commands on remote hosts
 * Manages agent-view sessions on remote machines via SSH
 */

import { spawn, spawnSync } from "child_process"
import { promisify } from "util"
import { exec, execFile } from "child_process"
import path from "path"
import os from "os"
import fs from "fs"
import type { Session, RemoteSession, SessionStatus, Tool } from "./types"
import type { TmuxExecutor } from "./tmux"

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

// SSH ControlMaster settings for connection reuse
const SSH_CONTROL_DIR = "/tmp/agent-view-ssh"
const SSH_CONTROL_PERSIST = 600 // seconds
const SSH_TIMEOUT = 10 // seconds
const LOCAL_TMUX_CONF = path.join(os.homedir(), ".agent-view", "tmux.conf")
const TMUX_SOCKET = "agent-view"
// Remote path where we upload the tmux.conf (relative, SSH expands ~)
const REMOTE_TMUX_CONF = "~/.agent-view/tmux.conf"

const logFile = path.join(os.homedir(), ".agent-orchestrator", "debug.log")
function log(...args: unknown[]) {
  const msg = `[${new Date().toISOString()}] [SSH] ${args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ")}\n`
  try { fs.appendFileSync(logFile, msg) } catch {}
}

/**
 * Ensure the SSH control directory exists
 */
function ensureControlDir(): void {
  try {
    if (!fs.existsSync(SSH_CONTROL_DIR)) {
      fs.mkdirSync(SSH_CONTROL_DIR, { recursive: true, mode: 0o700 })
    }
  } catch {
    // Ignore errors - connection will work without ControlMaster
  }
}

/**
 * Build SSH options for connection reuse
 */
function sshOptions(host: string): string[] {
  ensureControlDir()
  return [
    "-o", "ControlMaster=auto",
    "-o", `ControlPath=${SSH_CONTROL_DIR}/%r@%h:%p`,
    "-o", `ControlPersist=${SSH_CONTROL_PERSIST}`,
    "-o", "BatchMode=yes",
    "-o", `ConnectTimeout=${SSH_TIMEOUT}`,
    "-o", "StrictHostKeyChecking=accept-new",
  ]
}

export class SSHRunner {
  constructor(
    private name: string,
    private host: string,
    private avPath: string = "av"
  ) {}

  /**
   * Execute an av command on the remote host
   */
  async run(args: string[]): Promise<string> {
    // Build the remote command as a single quoted string
    // This preserves arguments with spaces when passed through SSH
    const quotedArgs = args.map(arg => {
      // If arg contains spaces or special chars, quote it
      if (arg.includes(" ") || arg.includes("'") || arg.includes('"')) {
        // Escape single quotes and wrap in single quotes
        return `'${arg.replace(/'/g, "'\\''")}'`
      }
      return arg
    })
    const remoteCommand = `${this.avPath} ${quotedArgs.join(" ")}`

    const sshArgs = [
      ...sshOptions(this.host),
      this.host,
      remoteCommand
    ]

    log(`Running SSH command: ssh ${sshArgs.join(" ")}`)

    try {
      const { stdout, stderr } = await execFileAsync("ssh", sshArgs, {
        timeout: SSH_TIMEOUT * 1000,
        maxBuffer: 10 * 1024 * 1024 // 10MB
      })

      if (stderr) {
        log(`SSH stderr: ${stderr}`)
      }

      return stdout
    } catch (err: any) {
      log(`SSH error: ${err.message}`)
      throw new Error(`SSH to ${this.name}: ${err.message}`)
    }
  }

  /**
   * Fetch sessions from remote via `av --list --json`
   */
  async fetchSessions(): Promise<RemoteSession[]> {
    try {
      const output = await this.run(["--list", "--json"])

      if (!output.trim()) {
        return []
      }

      const sessions = JSON.parse(output) as Session[]

      return sessions.map(s => ({
        ...s,
        // Parse dates from JSON
        createdAt: new Date(s.createdAt),
        lastAccessed: new Date(s.lastAccessed),
        // Add remote metadata
        remoteName: this.name,
        remoteHost: this.host,
        // Prefix group path with remote name for display
        groupPath: `@${this.name}/${s.groupPath}`
      }))
    } catch (err: any) {
      log(`Failed to fetch sessions from ${this.name}: ${err.message}`)
      return []
    }
  }

  attach(sessionId: string): void {
    log(`Attaching to remote session ${sessionId} on ${this.name}`)

    // Exit alternate screen buffer before attaching
    process.stdout.write("\x1b[?1049l")
    process.stdout.write("\x1b[2J\x1b[H")
    process.stdout.write("\x1b[?25h")

    const sshArgs = [
      "-t", // Force TTY allocation
      "-o", `ConnectTimeout=${SSH_TIMEOUT}`,
      "-o", "StrictHostKeyChecking=accept-new",
      this.host,
      this.avPath,
      "--attach",
      sessionId
    ]

    const child = spawn("ssh", sshArgs, {
      stdio: "inherit",
      env: process.env
    })

    child.on("exit", () => {
      // Clear screen and re-enter alternate buffer for TUI
      process.stdout.write("\x1b[2J\x1b[H")
      process.stdout.write("\x1b[?1049h")
      process.stdout.write("\x1b]0;Agent View\x07")
    })
  }

  /**
   * Attach synchronously (blocks until detach)
   * Returns true if Ctrl+L (session list) was requested
   */
  attachSync(sessionId: string): boolean {
    log(`Attaching sync to remote session ${sessionId} on ${this.name}`)
    const { spawnSync } = require("child_process")

    // Exit alternate screen buffer
    process.stdout.write("\x1b[?1049l")
    process.stdout.write("\x1b[2J\x1b[H")
    process.stdout.write("\x1b[?25h")

    const sshArgs = [
      "-t",
      "-o", `ConnectTimeout=${SSH_TIMEOUT}`,
      "-o", "StrictHostKeyChecking=accept-new",
      this.host,
      this.avPath,
      "--attach",
      sessionId
    ]

    spawnSync("ssh", sshArgs, {
      stdio: "inherit",
      env: process.env
    })

    // Check if Ctrl+L was pressed on remote by checking signal file
    let sessionListRequested = false
    try {
      const checkResult = spawnSync("ssh", [
        ...sshOptions(this.host),
        this.host,
        "test -f /tmp/agent-view-session-list && rm /tmp/agent-view-session-list && echo yes"
      ], { encoding: "utf-8", timeout: 5000 })
      sessionListRequested = checkResult.stdout?.trim() === "yes"
    } catch {
      // Ignore errors
    }

    // Clear screen and re-enter alternate buffer for TUI
    process.stdout.write("\x1b[2J\x1b[H")
    process.stdout.write("\x1b[?1049h")
    process.stdout.write("\x1b]0;Agent View\x07")

    return sessionListRequested
  }

  /**
   * Stop a remote session
   */
  async stop(sessionId: string): Promise<void> {
    await this.run(["--stop", sessionId])
  }

  async send(sessionId: string, message: string): Promise<void> {
    await this.run(["--send", sessionId, message])
  }

  async acknowledge(sessionId: string): Promise<void> {
    await this.run(["--acknowledge", sessionId])
  }

  async confirm(sessionId: string): Promise<void> {
    await this.run(["--confirm", sessionId])
  }

  async interrupt(sessionId: string): Promise<void> {
    await this.run(["--interrupt", sessionId])
  }

  async output(sessionId: string, lines = 200): Promise<string> {
    return await this.run(["--output", sessionId, "--lines", String(lines)])
  }

  /**
   * Restart a remote session
   */
  async restart(sessionId: string): Promise<void> {
    await this.run(["--restart", sessionId])
  }

  /**
   * Delete a remote session (with --force to skip confirmation)
   */
  async delete(sessionId: string): Promise<void> {
    await this.run(["--delete", sessionId, "--force"])
  }

  /**
   * Hibernate a remote session (Claude only)
   */
  async hibernate(sessionId: string): Promise<void> {
    await this.run(["--hibernate", sessionId])
  }

  /**
   * Resume a remote session (Claude only) - uses 'wake' CLI command
   */
  async resume(sessionId: string): Promise<void> {
    await this.run(["--wake", sessionId])
  }

  /**
   * Test SSH connectivity to the remote host
   */
  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      const sshArgs = [
        ...sshOptions(this.host),
        this.host,
        "echo", "ok"
      ]

      await execFileAsync("ssh", sshArgs, {
        timeout: SSH_TIMEOUT * 1000
      })

      return { ok: true }
    } catch (err: any) {
      return { ok: false, error: err.message }
    }
  }

  /**
   * Check if av is available on the remote host
   * Checks configured path first, then default install location
   */
  async checkAvailable(): Promise<{ ok: boolean; version?: string; path?: string; error?: string }> {
    // First try the configured avPath
    try {
      const output = await this.run(["-v"])
      const version = output.trim()
      return { ok: true, version, path: this.avPath }
    } catch {
      // Configured path failed, try default install location
    }

    // Try default install path
    const defaultPath = "~/.agent-view/bin/av"
    if (this.avPath !== defaultPath) {
      try {
        const sshArgs = [
          ...sshOptions(this.host),
          this.host,
          `${defaultPath} -v`
        ]
        const { stdout } = await execFileAsync("ssh", sshArgs, {
          timeout: SSH_TIMEOUT * 1000
        })
        const version = stdout.trim()
        return { ok: true, version, path: defaultPath }
      } catch {
        // Default path also failed
      }
    }

    return { ok: false, error: "av not found on remote" }
  }

  /**
   * Install av on the remote host using the install script
   */
  async installAv(): Promise<{ success: boolean; error?: string }> {
    try {
      // Don't use BatchMode for install - it needs to run curl | bash
      const sshArgs = [
        "-o", `ConnectTimeout=${SSH_TIMEOUT}`,
        "-o", "StrictHostKeyChecking=accept-new",
        this.host,
        "curl -fsSL https://raw.githubusercontent.com/frayo44/agent-view/main/install.sh | bash"
      ]

      log(`Installing av on remote: ssh ${sshArgs.join(" ")}`)

      const { stdout, stderr } = await execFileAsync("ssh", sshArgs, {
        timeout: 180000, // 3 minutes for install
        maxBuffer: 10 * 1024 * 1024
      })

      log(`Install stdout: ${stdout}`)
      if (stderr) {
        log(`Install stderr: ${stderr}`)
      }

      return { success: true }
    } catch (err: any) {
      log(`Install error: ${err.message}`)
      return { success: false, error: err.message }
    }
  }

  /**
   * Create a new session on the remote host
   */
  async create(options: {
    title?: string
    projectPath: string
    tool: string
    group?: string
    command?: string
  }): Promise<{ success: boolean; error?: string }> {
    const args = ["--new", "--path", options.projectPath, "--tool", options.tool]

    if (options.title) {
      args.push("--title", options.title)
    }
    if (options.group) {
      args.push("--group", options.group)
    }
    if (options.command && options.tool === "custom") {
      args.push("--command", options.command)
    }

    try {
      await this.run(args)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }
}

export type SshConnectionStatus = "connecting" | "connected" | "offline"

export class SshControlManager {
  private statusMap = new Map<string, SshConnectionStatus>()

  getSocketPath(alias: string): string {
    const safe = alias.replace(/[^a-zA-Z0-9_.-]/g, "_")
    return path.join(SSH_CONTROL_DIR, `${safe}.sock`)
  }

  getStatus(alias: string): SshConnectionStatus {
    return this.statusMap.get(alias) ?? "offline"
  }

  async connect(alias: string): Promise<void> {
    if (this.statusMap.get(alias) === "connecting") return
    this.statusMap.set(alias, "connecting")

    const socketPath = this.getSocketPath(alias)
    try {
      await execFileAsync("ssh", [
        "-o", `ControlPath=${socketPath}`,
        "-O", "check",
        alias
      ])
      this.statusMap.set(alias, "connected")
      return
    } catch {
      // Socket not alive - start new ControlMaster.
    }

    try {
      const args = [
        "-o", "ControlMaster=yes",
        "-o", `ControlPath=${socketPath}`,
        "-o", "ControlPersist=3600",
        "-o", "ConnectTimeout=10",
        "-o", "BatchMode=yes",   // Fail fast if auth requires interactive input
        "-fN",                   // Background, no command
        alias
      ]
      await execFileAsync("ssh", args, {
        timeout: SSH_TIMEOUT * 1000
      })
      this.statusMap.set(alias, "connected")
    } catch (err) {
      this.statusMap.set(alias, "offline")
      throw err
    }

    // Upload local tmux.conf to remote so Ctrl+Q detach binding works
    await this.uploadTmuxConf(alias, socketPath)
  }

  /**
   * Upload the local agent-view tmux.conf to the remote host.
   * This ensures the remote tmux server uses the same key bindings (e.g. Ctrl+Q to detach).
   */
  private async uploadTmuxConf(alias: string, socketPath: string): Promise<void> {
    try {
      const confContent = fs.readFileSync(LOCAL_TMUX_CONF, "utf-8")
      // Create remote dir and stream conf content via stdin (reuses ControlMaster socket)
      await new Promise<void>((resolve, reject) => {
        const child = spawn("ssh", [
          "-o", "ControlMaster=no",
          "-o", `ControlPath=${socketPath}`,
          alias,
          "mkdir -p ~/.agent-view && cat > ~/.agent-view/tmux.conf"
        ])
        child.stdin.write(confContent)
        child.stdin.end()
        child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`upload exit ${code}`)))
        child.on("error", reject)
      })
    } catch {
      // Non-fatal: Ctrl+Q won't work but session will still function
    }
  }

  async check(alias: string): Promise<boolean> {
    try {
      const args = [
        ...sshOptions(alias),
        "-O", "check",
        alias
      ]
      await execFileAsync("ssh", args, {
        timeout: SSH_TIMEOUT * 1000
      })
      this.statusMap.set(alias, "connected")
      return true
    } catch {
      this.statusMap.set(alias, "offline")
      return false
    }
  }

  async disconnect(alias: string): Promise<void> {
    try {
      const args = [
        ...sshOptions(alias),
        "-O", "exit",
        alias
      ]
      await execFileAsync("ssh", args, {
        timeout: SSH_TIMEOUT * 1000
      })
    } catch {
      // Ignore disconnect errors
    }
    this.statusMap.set(alias, "offline")
  }

  async disconnectAll(): Promise<void> {
    const aliases = [...this.statusMap.keys()]
    await Promise.all(aliases.map(alias => this.disconnect(alias)))
  }

  async execRemote(alias: string, args: string[]): Promise<string> {
    const socketPath = this.getSocketPath(alias)
    // SSH concatenates args with spaces and passes them to the remote shell.
    // Single-quote each arg to prevent the shell from misinterpreting special
    // characters — most critically '#' which starts a comment and causes tmux
    // format strings like #{session_name} to be silently discarded.
    // Exception: args starting with '~' are left unquoted so tilde expands.
    const remoteCmd = args
      .map(a => /^~/.test(a) ? a : "'" + a.replace(/'/g, "'\\''") + "'")
      .join(" ")
    const { stdout } = await execFileAsync("ssh", [
      "-o", "ControlMaster=no",
      "-o", `ControlPath=${socketPath}`,
      alias,
      remoteCmd
    ], { timeout: 10000 })
    return stdout
  }
}

export class SshTmuxExecutor implements TmuxExecutor {
  private lastUploadedConf: string | null = null
  private lastUploadTime = 0
  private static CONF_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

  constructor(
    private alias: string,
    private manager: SshControlManager
  ) {}

  private tmuxArgs(...args: string[]): string[] {
    // Use the uploaded tmux.conf on the remote so Ctrl+Q detach binding works
    return ["tmux", "-L", TMUX_SOCKET, "-f", REMOTE_TMUX_CONF, ...args]
  }

  async exec(args: string[]): Promise<string> {
    return this.manager.execRemote(this.alias, this.tmuxArgs(...args))
  }

  async execFile(args: string[]): Promise<void> {
    await this.manager.execRemote(this.alias, this.tmuxArgs(...args))
  }

  spawnAttach(sessionName: string): void {
    const socketPath = this.manager.getSocketPath(this.alias)

    this.uploadTmuxConfSync(socketPath)

    process.stdout.write("\x1b[?1049l\x1b[2J\x1b[H\x1b[?25h")
    // Brief connection hint (visible until tmux renders over it)
    process.stdout.write(`\r\nConnecting to ${this.alias}... (Ctrl+Q to detach | auto-disconnect after 30s silence)\r\n\r\n`)
    const sshArgs = [
      "-t",
      "-o", "ConnectTimeout=10",
      "-o", "ControlMaster=no",
      "-o", `ControlPath=${socketPath}`,
      "-o", "ServerAliveInterval=10",  // send keepalive every 10s
      "-o", "ServerAliveCountMax=3",   // exit after 3 missed responses (~30s)
      "-o", "TCPKeepAlive=yes",
      this.alias,
      ...this.tmuxArgs("attach-session", "-t", sessionName)
    ]

    // SSH -t for interactive PTY, attach to remote tmux session (blocking)
    const result = spawnSync("ssh", sshArgs, { stdio: "inherit" })
    // If SSH exited abnormally (network loss detected via keepalive), show a
    // visible message before restoring TUI so user knows what happened.
    if (result.status !== 0 || result.error) {
      process.stdout.write(`\r\n\x1b[33m[agent-view] Connection to ${this.alias} lost. Returning to TUI...\x1b[0m\r\n`)
      // Pause so user can read the message before TUI buffer takes over
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500)
    }
    process.stdout.write("\x1b[2J\x1b[H\x1b[?1049h\x1b]0;Agent View\x07")

    // Propagate SSH/tmux errors so doAttach can show them as toast
    if (result.error) {
      throw result.error
    }
    if (result.status !== null && result.status !== 0) {
      throw new Error(`Remote attach failed (exit ${result.status}): ssh ${this.alias} tmux attach-session -t ${sessionName}`)
    }
  }

  private uploadTmuxConfSync(socketPath: string): void {
    try {
      const confContent = fs.readFileSync(LOCAL_TMUX_CONF, "utf-8")
      const { execFileSync } = require("child_process")
      execFileSync("ssh", [
        "-o", "ControlMaster=no",
        "-o", `ControlPath=${socketPath}`,
        this.alias,
        "sh", "-c", "mkdir -p ~/.agent-view && cat > ~/.agent-view/tmux.conf"
      ], { input: confContent, timeout: 5000 })
    } catch {
      // Non-fatal: Ctrl+Q won't work but attach can still proceed.
    }
  }

  /**
   * Synchronously upload local tmux.conf to remote.
   * Used in spawnAttach to guarantee Ctrl+Q binding is available.
   * Non-fatal: if upload fails, Ctrl+Q won't work but attach still proceeds.
   */
  private uploadTmuxConfSync(socketPath: string): void {
    try {
      const confContent = fs.readFileSync(LOCAL_TMUX_CONF, "utf-8")

      // Skip upload if conf content hasn't changed and was uploaded recently
      const now = Date.now()
      if (
        this.lastUploadedConf === confContent &&
        now - this.lastUploadTime < SshTmuxExecutor.CONF_CACHE_TTL
      ) {
        return
      }

      // Upload conf file
      execFileSync("ssh", [
        "-o", "ControlMaster=no",
        "-o", `ControlPath=${socketPath}`,
        this.alias,
        "mkdir -p ~/.agent-view && cat > ~/.agent-view/tmux.conf"
      ], { input: confContent, timeout: 5000 })
      // Reload conf on the running tmux server so Ctrl+Q binding takes effect immediately.
      // source-file is safe to run even if no sessions exist (server may not be running yet).
      execFileSync("ssh", [
        "-o", "ControlMaster=no",
        "-o", `ControlPath=${socketPath}`,
        this.alias,
        "tmux", "-L", TMUX_SOCKET, "source-file", REMOTE_TMUX_CONF
      ], { timeout: 3000 })

      // Cache successful upload
      this.lastUploadedConf = confContent
      this.lastUploadTime = now
    } catch {
      // Non-fatal: Ctrl+Q won't work but session will still function
    }
  }
}
let sshManagerSingleton: SshControlManager | null = null

export function getSshManager(): SshControlManager {
  if (!sshManagerSingleton) {
    sshManagerSingleton = new SshControlManager()
  }
  return sshManagerSingleton
}
