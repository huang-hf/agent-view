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

import { execFile, spawn } from "child_process"
import { promisify } from "util"
import path from "path"
import os from "os"
import fs from "fs"
import type { TmuxExecutor } from "./tmux"

const execFileAsync = promisify(execFile)

const SOCKET_DIR = path.join(os.homedir(), ".agent-view", "ssh-ctl")
const TMUX_SOCKET = "agent-view"

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
        "-o", "ControlPersist=120",
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
    const { stdout } = await execFileAsync("ssh", [
      "-o", "ControlMaster=no",
      "-o", `ControlPath=${socketPath}`,
      alias,
      ...args
    ])
    return stdout
  }
}

/**
 * TmuxExecutor that runs tmux commands on a remote host via SSH ControlMaster.
 */
export class SshTmuxExecutor implements TmuxExecutor {
  constructor(
    private alias: string,
    private manager: SshControlManager
  ) {}

  async exec(args: string[]): Promise<string> {
    return this.manager.execRemote(this.alias, [
      "tmux", "-L", TMUX_SOCKET, ...args
    ])
  }

  async execFile(args: string[]): Promise<void> {
    await this.manager.execRemote(this.alias, [
      "tmux", "-L", TMUX_SOCKET, ...args
    ])
  }

  spawnAttach(sessionName: string): void {
    const socketPath = this.manager.getSocketPath(this.alias)

    // Exit TUI alternate screen buffer
    process.stdout.write("\x1b[?1049l\x1b[2J\x1b[H\x1b[?25h")

    // SSH -t for interactive PTY, attach to remote tmux session
    const child = spawn("ssh", [
      "-t",
      "-o", "ControlMaster=no",
      "-o", `ControlPath=${socketPath}`,
      this.alias,
      "tmux", "-L", TMUX_SOCKET, "attach-session", "-t", sessionName
    ], { stdio: "inherit" })

    child.on("exit", () => {
      // Re-enter TUI alternate screen buffer
      process.stdout.write("\x1b[2J\x1b[H\x1b[?1049h\x1b]0;Agent View\x07")
    })
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
