# SSH Remote Session Management — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow a single agent-view instance to manage both local and remote Claude Code sessions via SSH ControlMaster, with no software required on the remote server beyond `tmux` and `claude`.

**Architecture:** Abstract a `TmuxExecutor` interface in `tmux.ts` so all tmux operations route through either `LocalTmuxExecutor` (existing behavior) or `SshTmuxExecutor` (SSH ControlMaster). `SessionManager` selects the executor based on `session.remoteHost`. Remote host configuration lives in `~/.agent-view/config.json` as aliases that map to `~/.ssh/config` Host entries.

**Tech Stack:** Bun, TypeScript, Solid.js, OpenTUI, SQLite (bun:sqlite), node `child_process.execFile`

---

## Task 1: Add `RemoteHost` type and `remoteHost` to Session

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/config.ts`

**Step 1: Add `RemoteHost` interface to `types.ts`**

In `src/core/types.ts`, add after the `Recent` interface (around line 118):

```ts
export interface RemoteHost {
  alias: string    // Must match a Host entry in ~/.ssh/config
  label?: string   // Optional display name (defaults to alias)
}
```

Add `"offline"` to `SessionStatus` union (line 6):

```ts
export type SessionStatus =
  | "running"
  | "waiting"
  | "idle"
  | "error"
  | "stopped"
  | "hibernated"
  | "offline"      // Remote host unreachable
```

Add `remoteHost` to `Session` interface (after `acknowledged` on line 41):

```ts
export interface Session {
  // ...existing fields
  acknowledged: boolean
  remoteHost: string   // SSH alias; empty string = local
}
```

**Step 2: Add `remoteHosts` to `AppConfig` in `config.ts`**

In `src/core/config.ts`, add to the `AppConfig` interface (after `autoHibernatePrompted`):

```ts
export interface AppConfig {
  // ...existing fields
  autoHibernatePrompted?: boolean
  remoteHosts?: RemoteHost[]
}
```

Add import at top of `config.ts`:

```ts
import type { Tool, Shortcut, Recent, RemoteHost } from "./types"
```

**Step 3: Verify build passes**

```bash
bun run build
```

Expected: Build successful, no type errors.

**Step 4: Commit**

```bash
git add src/core/types.ts src/core/config.ts
git commit -m "feat(ssh): add RemoteHost type and remoteHost field to Session"
```

---

## Task 2: SQLite migration — add `remote_host` column

**Files:**
- Modify: `src/core/storage.ts`

**Step 1: Add `remote_host` column to `migrate()` in `storage.ts`**

In `src/core/storage.ts`, bump `SCHEMA_VERSION` to `2` (line 13):

```ts
const SCHEMA_VERSION = 2
```

In the `migrate()` method, after the `CREATE TABLE IF NOT EXISTS sessions` block, add a migration for the new column:

```ts
// Migration: add remote_host column (schema v2)
this.db.exec(`
  ALTER TABLE sessions ADD COLUMN remote_host TEXT NOT NULL DEFAULT ''
`).catch?.(() => {}) // Column may already exist
```

Since `bun:sqlite`'s `exec` throws on duplicate columns (not returns), wrap it:

```ts
try {
  this.db.exec("ALTER TABLE sessions ADD COLUMN remote_host TEXT NOT NULL DEFAULT ''")
} catch {
  // Column already exists — safe to ignore
}
```

**Step 2: Update `saveSession` to include `remote_host`**

In `saveSession()`, update the INSERT statement to add `remote_host`:

```ts
const stmt = this.db.prepare(`
  INSERT OR REPLACE INTO sessions (
    id, title, project_path, group_path, sort_order,
    command, wrapper, tool, status, tmux_session,
    created_at, last_accessed,
    parent_session_id, worktree_path, worktree_repo, worktree_branch,
    tool_data, acknowledged, remote_host
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

stmt.run(
  session.id,
  // ...existing fields in same order...
  session.acknowledged ? 1 : 0,
  session.remoteHost || ""
)
```

Do the same for `saveSessions()` — update both the INSERT statement and the `.run()` call.

**Step 3: Update `loadSessions()` and `getSession()` to read `remote_host`**

In the SELECT statements, add `remote_host` to the column list.

In the row mapping, add:

```ts
remoteHost: row.remote_host || ""
```

**Step 4: Verify build passes**

```bash
bun run build
```

**Step 5: Commit**

```bash
git add src/core/storage.ts
git commit -m "feat(ssh): add remote_host column to sessions table"
```

---

## Task 3: `TmuxExecutor` interface + `LocalTmuxExecutor`

**Files:**
- Modify: `src/core/tmux.ts`
- Modify: `src/core/tmux.test.ts`

**Step 1: Define `TmuxExecutor` interface in `tmux.ts`**

Add after the imports section (around line 30), before `SESSION_PREFIX`:

```ts
/**
 * Abstraction for executing tmux commands either locally or via SSH.
 */
export interface TmuxExecutor {
  /** Run a tmux subcommand, return stdout */
  exec(args: string[]): Promise<string>
  /** Run a tmux subcommand that produces no relevant output */
  execFile(args: string[]): Promise<void>
  /** Full-screen attach (replaces current terminal process) */
  spawnAttach(sessionName: string): void
}
```

**Step 2: Implement `LocalTmuxExecutor` in `tmux.ts`**

Add after the `TmuxExecutor` interface:

```ts
export class LocalTmuxExecutor implements TmuxExecutor {
  async exec(args: string[]): Promise<string> {
    ensureConfig()
    const { stdout } = await execAsync(
      `tmux -L ${TMUX_SOCKET} -f "${CONFIG_PATH}" ${args.join(" ")}`
    )
    return stdout
  }

  async execFile(args: string[]): Promise<void> {
    await execFileAsync("tmux", tmuxSpawnArgs(...args))
  }

  spawnAttach(sessionName: string): void {
    attachSessionSync(sessionName)
  }
}

export const localExecutor = new LocalTmuxExecutor()
```

**Step 3: Write test for `LocalTmuxExecutor`**

In `src/core/tmux.test.ts`, add at the end:

```ts
describe("LocalTmuxExecutor", () => {
  test("implements TmuxExecutor interface", () => {
    const executor = new LocalTmuxExecutor()
    expect(typeof executor.exec).toBe("function")
    expect(typeof executor.execFile).toBe("function")
    expect(typeof executor.spawnAttach).toBe("function")
  })

  test("localExecutor is a LocalTmuxExecutor instance", () => {
    expect(localExecutor).toBeInstanceOf(LocalTmuxExecutor)
  })
})
```

**Step 4: Run tests**

```bash
bun test src/core/tmux.test.ts
```

Expected: all tests pass.

**Step 5: Commit**

```bash
git add src/core/tmux.ts src/core/tmux.test.ts
git commit -m "feat(ssh): add TmuxExecutor interface and LocalTmuxExecutor"
```

---

## Task 4: `SshTmuxExecutor` and ControlMaster management (`ssh.ts`)

**Files:**
- Create: `src/core/ssh.ts`
- Create: `src/core/ssh.test.ts`

**Step 1: Write tests first (`ssh.test.ts`)**

```ts
import { describe, test, expect, beforeEach } from "bun:test"
import { SshControlManager, SshTmuxExecutor } from "./ssh"

describe("SshControlManager", () => {
  test("getSocketPath returns consistent path for same alias", () => {
    const mgr = new SshControlManager()
    const p1 = mgr.getSocketPath("gpu-3090")
    const p2 = mgr.getSocketPath("gpu-3090")
    expect(p1).toBe(p2)
    expect(p1).toContain("gpu-3090")
  })

  test("getSocketPath returns different paths for different aliases", () => {
    const mgr = new SshControlManager()
    const p1 = mgr.getSocketPath("host-a")
    const p2 = mgr.getSocketPath("host-b")
    expect(p1).not.toBe(p2)
  })

  test("getStatus returns offline for unknown host", () => {
    const mgr = new SshControlManager()
    expect(mgr.getStatus("unknown")).toBe("offline")
  })

  test("getStatus returns known values", () => {
    const mgr = new SshControlManager()
    const valid = ["connecting", "connected", "offline"]
    const status = mgr.getStatus("any")
    expect(valid).toContain(status)
  })
})

describe("SshTmuxExecutor", () => {
  test("implements TmuxExecutor interface", () => {
    const mgr = new SshControlManager()
    const exec = new SshTmuxExecutor("gpu-3090", mgr)
    expect(typeof exec.exec).toBe("function")
    expect(typeof exec.execFile).toBe("function")
    expect(typeof exec.spawnAttach).toBe("function")
  })
})
```

**Step 2: Run tests to confirm they fail**

```bash
bun test src/core/ssh.test.ts
```

Expected: FAIL — `ssh.ts` does not exist yet.

**Step 3: Implement `src/core/ssh.ts`**

```ts
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
```

**Step 4: Run tests**

```bash
bun test src/core/ssh.test.ts
```

Expected: all tests pass.

**Step 5: Commit**

```bash
git add src/core/ssh.ts src/core/ssh.test.ts
git commit -m "feat(ssh): add SshControlManager and SshTmuxExecutor"
```

---

## Task 5: SessionManager — executor routing + remote status polling

**Files:**
- Modify: `src/core/session.ts`

**Step 1: Import SSH utilities in `session.ts`**

Add imports at top of `src/core/session.ts`:

```ts
import { getSshManager, SshTmuxExecutor } from "./ssh"
import { localExecutor, type TmuxExecutor } from "./tmux"
```

**Step 2: Add `getExecutor()` helper to `SessionManager`**

Add as a private method:

```ts
private getExecutor(remoteHost: string): TmuxExecutor {
  if (!remoteHost) return localExecutor
  return new SshTmuxExecutor(remoteHost, getSshManager())
}
```

**Step 3: Update `refreshStatuses()` to route through executor**

In `refreshStatuses()`, group sessions by `remoteHost` and poll each host's executor:

```ts
async refreshStatuses(): Promise<void> {
  // Group sessions by host
  const storage = getStorage()
  const sessions = storage.loadSessions()

  // Collect all unique remote hosts
  const hosts = new Set(sessions.map(s => s.remoteHost || ""))

  for (const host of hosts) {
    const executor = this.getExecutor(host)
    const hostSessions = sessions.filter(s => (s.remoteHost || "") === host)

    // For remote hosts: verify connection is alive
    if (host) {
      const manager = getSshManager()
      const alive = await manager.check(host)
      if (!alive) {
        // Mark all sessions on this host as offline
        for (const session of hostSessions) {
          storage.writeStatus(session.id, "offline", session.tool)
        }
        continue
      }
    }

    // Refresh tmux session cache for this host
    try {
      const stdout = await executor.exec([
        "list-windows", "-a", "-F", '"#{session_name}\t#{window_activity}"'
      ])
      // Update the appropriate cache
      // (For local: uses existing sessionCache module variable)
      // (For remote: we process inline since there's one cache per executor)
      if (!host) {
        // Local: existing refreshSessionCache() already handles this via tmux module
        await tmux.refreshSessionCache()
      } else {
        // Remote: parse inline and store per-host
        this.updateRemoteCache(host, stdout)
      }
    } catch {
      // Host unreachable
      for (const session of hostSessions) {
        storage.writeStatus(session.id, "offline", session.tool)
      }
      continue
    }

    // Poll each session on this host
    for (const session of hostSessions) {
      if (!session.tmuxSession) continue
      if (session.status === "hibernated") continue

      try {
        const output = await executor.exec([
          "capture-pane", "-t", session.tmuxSession,
          "-p", "-S", "-100"
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
      } catch {
        storage.writeStatus(session.id, "offline", session.tool)
      }
    }
  }

  storage.touch()
}
```

Add `remoteSessionCaches` map and `updateRemoteCache()` to the class:

```ts
private remoteSessionCaches = new Map<string, Set<string>>() // host -> session names

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
```

**Step 4: Update `create()` to support `remoteHost`**

In `SessionCreateOptions` (in `types.ts`), add:

```ts
export interface SessionCreateOptions {
  // ...existing fields
  remoteHost?: string
}
```

In `SessionManager.create()`, add `remoteHost` to the saved session:

```ts
const session: Session = {
  // ...existing fields
  remoteHost: options.remoteHost || ""
}
```

For remote sessions, create the tmux session via executor instead of local:

```ts
if (options.remoteHost) {
  const executor = this.getExecutor(options.remoteHost)
  // Use executor.exec() to create remote tmux session
  await executor.exec([
    "new-session", "-d", "-s", tmuxName,
    "-c", options.projectPath
  ])
  if (options.command) {
    await executor.execFile([
      "send-keys", "-t", tmuxName, "-l", options.command
    ])
    await executor.execFile(["send-keys", "-t", tmuxName, "Enter"])
  }
} else {
  // Existing local path
  await tmux.createSession({ name: tmuxName, command, cwd: options.projectPath, env, windowTitle: title })
}
```

**Step 5: Update `attach()` to use executor**

```ts
attach(sessionId: string): void {
  const session = getStorage().getSession(sessionId)
  if (!session?.tmuxSession) throw new Error("Session not found or not running")

  const executor = this.getExecutor(session.remoteHost)
  executor.spawnAttach(session.tmuxSession)
}
```

**Step 6: Update `stop()` and `killSession` calls to use executor**

For remote sessions, kill via executor:

```ts
async stop(sessionId: string): Promise<void> {
  const session = getStorage().getSession(sessionId)
  if (!session) return

  if (session.tmuxSession) {
    if (session.remoteHost) {
      const executor = this.getExecutor(session.remoteHost)
      await executor.exec(["kill-session", "-t", session.tmuxSession]).catch(() => {})
    } else {
      await tmux.killSession(session.tmuxSession)
    }
  }

  getStorage().writeStatus(sessionId, "stopped", session.tool)
  getStorage().touch()
}
```

**Step 7: Build to verify**

```bash
bun run build
```

Expected: no TypeScript errors.

**Step 8: Commit**

```bash
git add src/core/session.ts src/core/types.ts
git commit -m "feat(ssh): route session operations through TmuxExecutor"
```

---

## Task 6: Pre-connect remote hosts on app startup

**Files:**
- Modify: `src/tui/index.ts` (or wherever app initialization happens)

**Step 1: Find the app startup file**

```bash
grep -r "loadConfig\|startRefreshLoop" src/tui/ --include="*.ts" --include="*.tsx" -l
```

**Step 2: Add SSH pre-connect after config load**

In the app startup, after `loadConfig()`, add:

```ts
import { getSshManager } from "@/core/ssh"
import { getConfig } from "@/core/config"

// Pre-connect to all configured remote hosts
const config = getConfig()
for (const host of config.remoteHosts ?? []) {
  getSshManager().connect(host.alias).catch(() => {
    // Non-fatal: host will show as offline in TUI
  })
}
```

**Step 3: Disconnect on app exit**

Find the cleanup/exit handler (look for `process.on("exit")`), add:

```ts
getSshManager().disconnectAll().catch(() => {})
```

**Step 4: Build and verify**

```bash
bun run build
```

**Step 5: Commit**

```bash
git add src/tui/
git commit -m "feat(ssh): pre-connect remote hosts on startup"
```

---

## Task 7: New Session dialog — Host selector

**Files:**
- Modify: `src/tui/component/dialog-new.tsx`

**Step 1: Read existing dialog to understand the pattern**

Read `src/tui/component/dialog-new.tsx` in full before editing.

**Step 2: Add host selector signal and imports**

At the top of the `DialogNew` component, add:

```ts
import { getConfig } from "@/core/config"
import type { RemoteHost } from "@/core/types"

// Inside component:
const remoteHosts = () => getConfig().remoteHosts ?? []
const [selectedRemoteHost, setSelectedRemoteHost] = createSignal<string>("")  // "" = local
```

**Step 3: Add Host field to the form, above Tool**

In the form layout, add a Host row:

```tsx
{/* Host selector — only show if remoteHosts configured */}
<Show when={remoteHosts().length > 0}>
  <Row>
    <Text>Host:</Text>
    <DialogSelect
      inline
      options={[
        { title: "Local", value: "" },
        ...remoteHosts().map(h => ({
          title: h.label || h.alias,
          value: h.alias
        }))
      ]}
      value={selectedRemoteHost()}
      onSelect={opt => setSelectedRemoteHost(opt.value)}
    />
  </Row>
</Show>
```

**Step 4: Hide worktree option for remote sessions**

Wrap the worktree checkbox with:

```tsx
<Show when={!selectedRemoteHost()}>
  {/* existing worktree controls */}
</Show>
```

**Step 5: Pass `remoteHost` to session creation**

In `doCreate()`, add to the `create()` call:

```ts
await manager.create({
  // ...existing options
  remoteHost: selectedRemoteHost() || undefined
})
```

**Step 6: Build and verify**

```bash
bun run build
```

**Step 7: Commit**

```bash
git add src/tui/component/dialog-new.tsx
git commit -m "feat(ssh): add host selector to New Session dialog"
```

---

## Task 8: Home screen — show remote host tags and connection status

**Files:**
- Modify: `src/tui/routes/home.tsx`

**Step 1: Read `home.tsx` in full before editing**

**Step 2: Show remote host tag in session list item**

Find the session row rendering. Add a host prefix tag for remote sessions:

```tsx
<Show when={session.remoteHost}>
  <Text color={theme.muted}>[{session.remoteHost}] </Text>
</Show>
```

**Step 3: Show `offline` status visually**

In the status badge/color logic, add `offline` case:

```ts
case "offline": return { text: "offline", color: theme.muted }
```

**Step 4: Add connection status to group header for remote groups**

When rendering a group that contains remote sessions, show the SSH connection status:

```tsx
// In group header rendering:
const hostStatus = session.remoteHost
  ? getSshManager().getStatus(session.remoteHost)
  : null

// Show indicator: ● connected / ○ offline / … connecting
const indicator = hostStatus === "connected" ? "●"
  : hostStatus === "connecting" ? "…"
  : hostStatus === "offline" ? "○"
  : null
```

**Step 5: Build and verify**

```bash
bun run build
```

**Step 6: Commit**

```bash
git add src/tui/routes/home.tsx
git commit -m "feat(ssh): show remote host tags and connection status in home screen"
```

---

## Task 9: Settings dialog — Remote Hosts management

**Files:**
- Modify: `src/tui/component/dialog-settings.tsx`

**Step 1: Add "Remote Hosts" to the settings options list**

In `showSettingsList()`, add to the `options` array:

```ts
{
  title: "Remote hosts",
  value: "remoteHosts" as const,
  footer: `${(config.remoteHosts ?? []).length} configured`,
},
```

Add to the switch statement:

```ts
case "remoteHosts": return showRemoteHosts()
```

**Step 2: Implement `showRemoteHosts()` — list view**

```ts
function showRemoteHosts() {
  const config = getConfig()
  const hosts = config.remoteHosts ?? []

  const options = [
    ...hosts.map(h => ({
      title: `${h.label || h.alias}`,
      value: `host:${h.alias}`,
      footer: h.alias,
    })),
    { title: "+ Add remote host", value: "add" },
  ]

  dialog.push(() => (
    <DialogSelect
      title="Remote Hosts"
      options={options}
      skipFilter
      onSelect={async (opt) => {
        if (opt.value === "add") {
          showAddRemoteHost()
        } else {
          const alias = opt.value.replace("host:", "")
          showRemoteHostActions(alias)
        }
      }}
    />
  ))
}
```

**Step 3: Implement `showAddRemoteHost()` — input alias**

Use the existing `DialogInput` pattern (look at how other dialogs collect text input):

```ts
function showAddRemoteHost() {
  // Use DialogInput to collect alias
  dialog.push(() => (
    <DialogInput
      title={"Add Remote Host\n\nEnter the SSH alias from ~/.ssh/config:"}
      placeholder="e.g. gpu-3090"
      onSubmit={async (alias) => {
        if (!alias.trim()) { dialog.pop(); return }
        const config = getConfig()
        const hosts = [...(config.remoteHosts ?? [])]
        if (!hosts.find(h => h.alias === alias.trim())) {
          hosts.push({ alias: alias.trim() })
          await saveConfig({ ...config, remoteHosts: hosts })
          // Attempt to connect
          getSshManager().connect(alias.trim()).catch(() => {})
          toast.show({ message: `Added ${alias.trim()}`, variant: "success" })
        }
        dialog.pop()
        showRemoteHosts()
      }}
      onCancel={() => dialog.pop()}
    />
  ))
}
```

**Step 4: Implement `showRemoteHostActions()` — test / remove**

```ts
function showRemoteHostActions(alias: string) {
  dialog.push(() => (
    <DialogSelect
      title={`Host: ${alias}`}
      options={[
        { title: "Test connection", value: "test" },
        { title: "Remove", value: "remove" },
        { title: "Back", value: "back" },
      ]}
      skipFilter
      onSelect={async (opt) => {
        if (opt.value === "test") {
          toast.show({ message: `Testing ${alias}…`, variant: "info" })
          const ok = await getSshManager().check(alias)
          toast.show({
            message: ok ? `✓ ${alias} connected` : `✗ ${alias} unreachable`,
            variant: ok ? "success" : "error"
          })
        } else if (opt.value === "remove") {
          const config = getConfig()
          const hosts = (config.remoteHosts ?? []).filter(h => h.alias !== alias)
          await saveConfig({ ...config, remoteHosts: hosts })
          await getSshManager().disconnect(alias)
          toast.show({ message: `Removed ${alias}`, variant: "success" })
          dialog.pop()
          showRemoteHosts()
        } else {
          dialog.pop()
        }
      }}
    />
  ))
}
```

**Step 5: Build and verify**

```bash
bun run build
```

Expected: no TypeScript errors.

**Step 6: Commit**

```bash
git add src/tui/component/dialog-settings.tsx
git commit -m "feat(ssh): add Remote Hosts management to Settings dialog"
```

---

## Task 10: End-to-end manual test

**Prerequisites:** A remote server with `tmux` and `claude` installed, accessible via SSH.

**Step 1: Configure `~/.ssh/config`**

```
Host test-remote
    HostName <your-server-ip>
    Port     <port>
    User     <username>
    IdentityFile ~/.ssh/your-key
```

Verify it works: `ssh test-remote echo ok`

**Step 2: Install local build**

```bash
bun run install-local
```

**Step 3: Add remote host in Settings**

Launch `av`, press `c` → Remote Hosts → Add → type `test-remote` → Enter.

**Step 4: Verify connection indicator shows ●**

In home screen, the connection indicator for `test-remote` should show `●`.

**Step 5: Create a remote session**

Press `n` → Host: select `test-remote` → Tool: claude → create.
Verify session appears in list with `[test-remote]` prefix.

**Step 6: Verify status polling**

Wait ~2 seconds. The session status should update to `idle` or `running`.

**Step 7: Attach to remote session**

Press Enter on the remote session. Should launch `ssh -t test-remote tmux attach`.
Press Ctrl+Q to return to TUI.

**Step 8: Stop and delete**

Press `s` to stop, `d` to delete. Verify session removed.

**Step 9: Final build + install**

```bash
bun run install-local
```

---

## Task 11: Create feature branch and push PR

**Step 1: Create feature branch from main**

```bash
git checkout -b feat/ssh-remote main
git cherry-pick <all task commits>
```

Or if developed on main, just push directly:

```bash
git push fork feat/ssh-remote
```

**Step 2: Create PR**

```bash
gh pr create --repo Frayo44/agent-view \
  --head huang-hf:feat/ssh-remote \
  --base main \
  --title "feat: SSH remote session management" \
  --body "Adds ability to manage remote Claude Code sessions via SSH ControlMaster..."
```
