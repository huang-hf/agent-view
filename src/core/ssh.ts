/**
 * SSH ControlMaster management for remote tmux sessions.
 *
 * Uses SSH ControlMaster to maintain persistent connections to remote hosts,
 * so individual tmux commands reuse an existing socket instead of opening
 * a new SSH handshake each time (~10-50ms vs ~300ms per command).
 *
 * Authentication is fully delegated to ~/.ssh/config — agent-view never
 * stores passwords or private key paths.
 */

import { execFile, execFileSync, spawn, spawnSync } from "child_process"
import { promisify } from "util"
import path from "path"
import os from "os"
import fs from "fs"
import type { TmuxExecutor } from "./tmux"

const execFileAsync = promisify(execFile)

const SOCKET_DIR = path.join(os.homedir(), ".agent-view", "ssh-ctl")
const LOCAL_TMUX_CONF = path.join(os.homedir(), ".agent-view", "tmux.conf")
const TMUX_SOCKET = "agent-view"
// Remote path where we upload the tmux.conf (relative, SSH expands ~)
const REMOTE_TMUX_CONF = "~/.agent-view/tmux.conf"

export type SshConnectionStatus = "connecting" | "connected" | "offline"

/**
 * Manages SSH ControlMaster connections for multiple remote hosts.
 * One persistent SSH connection per host alias.
 */
export class SshControlManager {
  private statusMap = new Map<string, SshConnectionStatus>()

  constructor() {
    // Ensure socket directory exists
    if (!fs.existsSync(SOCKET_DIR)) {
      fs.mkdirSync(SOCKET_DIR, { recursive: true, mode: 0o700 })
    }
  }

  getSocketPath(alias: string): string {
    // Sanitize alias for use in filename
    const safe = alias.replace(/[^a-zA-Z0-9_.-]/g, "_")
    return path.join(SOCKET_DIR, `${safe}.sock`)
  }

  getStatus(alias: string): SshConnectionStatus {
    return this.statusMap.get(alias) ?? "offline"
  }

  /**
   * Connect to a remote host via SSH ControlMaster.
   * Idempotent — safe to call multiple times.
   */
  async connect(alias: string): Promise<void> {
    // Guard against concurrent connect() calls for the same alias
    if (this.statusMap.get(alias) === "connecting") return
    const socketPath = this.getSocketPath(alias)
    this.statusMap.set(alias, "connecting")

    try {
      // Check if ControlMaster socket already alive
      await execFileAsync("ssh", [
        "-o", `ControlPath=${socketPath}`,
        "-O", "check",
        alias
      ])
      this.statusMap.set(alias, "connected")
      return
    } catch {
      // Socket not alive — start new ControlMaster
    }

    try {
      // Start persistent background SSH connection
      await execFileAsync("ssh", [
        "-o", "ControlMaster=yes",
        "-o", `ControlPath=${socketPath}`,
        "-o", "ControlPersist=3600",
        "-o", "ConnectTimeout=10",
        "-o", "BatchMode=yes",   // Fail fast if auth requires interactive input
        "-fN",                   // Background, no command
        alias
      ])
      this.statusMap.set(alias, "connected")
    } catch (err) {
      this.statusMap.set(alias, "offline")
      throw new Error(`SSH connection failed for '${alias}': ${err}`)
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

  /**
   * Check if an existing ControlMaster socket is alive.
   * Updates internal status map.
   */
  async check(alias: string): Promise<boolean> {
    const socketPath = this.getSocketPath(alias)
    try {
      await execFileAsync("ssh", [
        "-o", `ControlPath=${socketPath}`,
        "-O", "check",
        alias
      ])
      this.statusMap.set(alias, "connected")
      return true
    } catch {
      this.statusMap.set(alias, "offline")
      return false
    }
  }

  /**
   * Stop a ControlMaster connection.
   */
  async disconnect(alias: string): Promise<void> {
    const socketPath = this.getSocketPath(alias)
    try {
      await execFileAsync("ssh", [
        "-o", `ControlPath=${socketPath}`,
        "-O", "stop",
        alias
      ])
    } catch {
      // Ignore errors on disconnect
    }
    this.statusMap.set(alias, "offline")
  }

  /**
   * Disconnect all managed connections. Call on app exit.
   */
  async disconnectAll(): Promise<void> {
    const aliases = [...this.statusMap.keys()]
    await Promise.all(aliases.map(a => this.disconnect(a)))
  }

  /**
   * Execute a command on the remote host via the ControlMaster socket.
   * Throws if the connection is offline.
   */
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

/**
 * TmuxExecutor that runs tmux commands on a remote host via SSH ControlMaster.
 */
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

    // Ensure tmux.conf is on the remote before attaching.
    // uploadTmuxConf() only runs in connect(), but the ControlMaster socket
    // may expire and reconnect without re-uploading. Upload synchronously here
    // so Ctrl+Q always works regardless of connection history.
    this.uploadTmuxConfSync(socketPath)

    // Exit TUI alternate screen buffer
    process.stdout.write("\x1b[?1049l\x1b[2J\x1b[H\x1b[?25h")

    // Brief connection hint (visible until tmux renders over it)
    process.stdout.write(`\r\nConnecting to ${this.alias}... (Ctrl+Q to detach | auto-disconnect after 30s silence)\r\n\r\n`)

    // Build SSH args — use ControlMaster socket if alive, otherwise direct connection
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

    // Re-enter TUI alternate screen buffer
    process.stdout.write("\x1b[2J\x1b[H\x1b[?1049h\x1b]0;Agent View\x07")

    // Propagate SSH/tmux errors so doAttach can show them as toast
    if (result.error) {
      throw result.error
    }
    if (result.status !== null && result.status !== 0) {
      throw new Error(`Remote attach failed (exit ${result.status}): ssh ${this.alias} tmux attach-session -t ${sessionName}`)
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

// Singleton manager
let globalManager: SshControlManager | null = null

export function getSshManager(): SshControlManager {
  if (!globalManager) {
    globalManager = new SshControlManager()
  }
  return globalManager
}
