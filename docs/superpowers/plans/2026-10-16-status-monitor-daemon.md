# Status Monitor Daemon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep session status continuously fresh via an always-on headless `av --monitor` process, launchd-managed on macOS, so the menu-bar widget and every DB consumer stop reading stale snapshots.

**Architecture:** A new headless CLI mode `av --monitor` runs only `SessionManager.startRefreshLoop(1000)` and stays alive — it never attaches to a session, so the `spawnSync` attach that blocks the TUI's event loop can never block it. A macOS launchd LaunchAgent (`RunAtLoad` + `KeepAlive`) keeps it running across login and crashes. Lifecycle is managed by an `av monitor install|uninstall|status` subcommand, wired into the install scripts so macOS users get it automatically. The existing primary-election scheme handles coexistence with an open TUI/web.

**Tech Stack:** Bun, TypeScript, bun:sqlite, macOS launchd/launchctl, bun test.

**Spec:** `docs/superpowers/specs/2026-10-16-status-monitor-daemon-design.md`

## Global Constraints

- Always `bun run build` after every code change before claiming it works (project rule, CLAUDE.md).
- When editing a file, verify every symbol you use is imported in that file first; add missing imports (project rule, CLAUDE.md).
- No new `AppConfig` field is introduced (so the settings-dialog obligation does not apply).
- Refresh interval for the monitor is exactly **1000ms** (TUI/web use 500ms).
- launchd label is exactly `com.agent-view.monitor`.
- Runtime files live in the agent-orchestrator dir: pidfile `~/.agent-orchestrator/monitor.pid`, log `~/.agent-orchestrator/monitor.log` (same dir as `state.db`, NOT `~/.agent-view`).
- launchd/launchctl behavior is macOS-only; on other platforms the `monitor` subcommand no-ops with a message and `--monitor` still runs.

---

### Task 1: CLI parsing for `--monitor` and `monitor <action>`

**Files:**
- Modify: `src/cli/args.ts` (CLICommand union at `:6-30`; parse body; `printHelp`)
- Test: `src/cli/args.test.ts`

**Interfaces:**
- Produces: two new `CLICommand` variants — `{ type: "monitor" }` and `{ type: "monitor-ctl"; action: "install" | "uninstall" | "status" }`. Consumed by Task 5 (`index.ts` dispatch).

- [ ] **Step 1: Write the failing tests**

Add to `src/cli/args.test.ts`:

```ts
test("parses --monitor", () => {
  expect(parseArgs(["node", "av", "--monitor"])).toEqual({ type: "monitor" })
})

test("parses monitor install", () => {
  expect(parseArgs(["node", "av", "monitor", "install"])).toEqual({ type: "monitor-ctl", action: "install" })
})

test("parses monitor uninstall", () => {
  expect(parseArgs(["node", "av", "monitor", "uninstall"])).toEqual({ type: "monitor-ctl", action: "uninstall" })
})

test("parses monitor status", () => {
  expect(parseArgs(["node", "av", "monitor", "status"])).toEqual({ type: "monitor-ctl", action: "status" })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/cli/args.test.ts`
Expected: FAIL — the four new cases return `{ type: "tui", ... }` instead.

- [ ] **Step 3: Add the union variants**

In `src/cli/args.ts`, extend the `CLICommand` union (after the `task-*` entries at `:30`):

```ts
  | { type: "monitor" }
  | { type: "monitor-ctl"; action: "install" | "uninstall" | "status" }
```

- [ ] **Step 4: Parse `--monitor` flag**

In `parseArgs`, add before the `if (getFlag(args, "--web"))` block (so it is checked early, near the other mode flags around `:76`):

```ts
  if (getFlag(args, "--monitor")) {
    return { type: "monitor" }
  }
```

- [ ] **Step 5: Parse the `monitor` subcommand**

In `parseArgs`, add immediately before the `if (args[0] === "task")` block at `:273`:

```ts
  if (args[0] === "monitor") {
    const sub = args[1]
    if (sub === "install" || sub === "uninstall" || sub === "status") {
      return { type: "monitor-ctl", action: sub }
    }
    console.error("Unknown monitor subcommand. Usage: av monitor [install|uninstall|status]")
    process.exit(1)
  }
```

- [ ] **Step 6: Document in help text**

In `printHelp` (the usage block around `:318-343`), add two lines near the `--web`/`--all` entries and the subcommand list:

```
  av --monitor                    Run the headless status monitor (used by launchd)
  av monitor <install|uninstall|status>   Manage the macOS launchd status monitor
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `bun test src/cli/args.test.ts`
Expected: PASS (all cases, including the pre-existing ones).

- [ ] **Step 8: Build**

Run: `bun run build`
Expected: no type errors (the `index.ts` switch does not yet handle the new variants — that is Task 5; if the build enforces exhaustiveness and fails, proceed to Step 9 and let Task 5 complete the dispatch. If it fails only due to the unhandled switch cases, that is expected at this point).

- [ ] **Step 9: Commit**

```bash
git add src/cli/args.ts src/cli/args.test.ts
git commit -m "feat(cli): parse --monitor and monitor install/uninstall/status"
```

---

### Task 2: launchd plist builder (pure) + runtime paths

**Files:**
- Create: `src/core/launchd.ts`
- Test: `src/core/launchd.test.ts`

**Interfaces:**
- Produces:
  - `LAUNCH_AGENT_LABEL: string` (= `"com.agent-view.monitor"`)
  - `plistPath(): string` (= `~/Library/LaunchAgents/com.agent-view.monitor.plist`)
  - `monitorPidFile(): string` (= `~/.agent-orchestrator/monitor.pid`)
  - `monitorLogFile(): string` (= `~/.agent-orchestrator/monitor.log`)
  - `buildPlist(avPath: string): string` — launchd plist XML
- Consumed by Task 3 (install/uninstall/status) and Task 4 (monitor reads `monitorPidFile`).

- [ ] **Step 1: Write the failing test**

Create `src/core/launchd.test.ts`:

```ts
import { test, expect } from "bun:test"
import { buildPlist, LAUNCH_AGENT_LABEL, monitorLogFile } from "./launchd"

test("buildPlist embeds label, av path + --monitor, and keepalive", () => {
  const xml = buildPlist("/Users/me/.agent-view/bin/agent-view")
  expect(xml).toContain("<?xml")
  expect(xml).toContain(`<string>${LAUNCH_AGENT_LABEL}</string>`)
  expect(xml).toContain("<string>/Users/me/.agent-view/bin/agent-view</string>")
  expect(xml).toContain("<string>--monitor</string>")
  expect(xml).toContain("<key>RunAtLoad</key>")
  expect(xml).toContain("<key>KeepAlive</key>")
  expect(xml).toContain(monitorLogFile())
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/core/launchd.test.ts`
Expected: FAIL — module `./launchd` not found.

- [ ] **Step 3: Implement the pure builder + paths**

Create `src/core/launchd.ts`:

```ts
import os from "os"
import path from "path"

export const LAUNCH_AGENT_LABEL = "com.agent-view.monitor"

function orchestratorDir(): string {
  return path.join(os.homedir(), ".agent-orchestrator")
}

export function monitorPidFile(): string {
  return path.join(orchestratorDir(), "monitor.pid")
}

export function monitorLogFile(): string {
  return path.join(orchestratorDir(), "monitor.log")
}

export function plistPath(): string {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`)
}

export function buildPlist(avPath: string): string {
  const log = monitorLogFile()
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${avPath}</string>
    <string>--monitor</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${log}</string>
  <key>StandardErrorPath</key>
  <string>${log}</string>
</dict>
</plist>
`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/core/launchd.test.ts`
Expected: PASS.

- [ ] **Step 5: Build**

Run: `bun run build`
Expected: no new errors from `launchd.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/core/launchd.ts src/core/launchd.test.ts
git commit -m "feat(monitor): launchd plist builder and runtime paths"
```

---

### Task 3: launchd install / uninstall / status (side effects)

**Files:**
- Modify: `src/core/launchd.ts`

**Interfaces:**
- Consumes: `LAUNCH_AGENT_LABEL`, `plistPath`, `buildPlist`, `monitorPidFile` (Task 2).
- Produces:
  - `resolveAvPath(): string` — absolute path to the real `av` binary
  - `async installAgent(): Promise<void>`
  - `async uninstallAgent(): Promise<void>`
  - `async agentStatus(): Promise<string>` — human-readable multi-line report
  - `isMacOS(): boolean`
- Consumed by Task 5 (`index.ts` `monitor-ctl` dispatch).

- [ ] **Step 1: Implement the side-effecting helpers**

Append to `src/core/launchd.ts` (add imports at the top of the file: `import { execFile } from "child_process"`, `import { promisify } from "util"`, `import * as fs from "fs"`, and extend the existing `os`/`path` imports as needed):

```ts
const execFileAsync = promisify(execFile)

export function isMacOS(): boolean {
  return process.platform === "darwin"
}

// Resolve the real av binary: follow the symlink chain from process.execPath's
// sibling `av`, else fall back to the running executable itself.
export function resolveAvPath(): string {
  const candidates = [
    path.join(os.homedir(), ".local", "bin", "av"),
    path.join(os.homedir(), ".agent-view", "bin", "agent-view"),
    process.execPath,
  ]
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return fs.realpathSync(c)
    } catch {
      // ignore and try next
    }
  }
  return process.execPath
}

async function launchctl(args: string[]): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync("launchctl", args)
    return { ok: true, output: (stdout || stderr || "").trim() }
  } catch (e: any) {
    return { ok: false, output: (e?.stderr || e?.message || "").trim() }
  }
}

export async function installAgent(): Promise<void> {
  if (!isMacOS()) {
    console.log("av monitor: launchd is macOS-only; skipping agent install.")
    return
  }
  const target = plistPath()
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.mkdirSync(path.join(os.homedir(), ".agent-orchestrator"), { recursive: true })
  fs.writeFileSync(target, buildPlist(resolveAvPath()))

  const domain = `gui/${process.getuid?.() ?? 0}`
  // Reload idempotently: bootout any existing instance (ignore failure), then bootstrap.
  await launchctl(["bootout", domain, target])
  const res = await launchctl(["bootstrap", domain, target])
  if (!res.ok) {
    console.warn(`av monitor: launchctl bootstrap reported: ${res.output}`)
  }
  console.log(`av monitor installed (${LAUNCH_AGENT_LABEL}).`)
}

export async function uninstallAgent(): Promise<void> {
  if (!isMacOS()) {
    console.log("av monitor: launchd is macOS-only; nothing to uninstall.")
    return
  }
  const target = plistPath()
  const domain = `gui/${process.getuid?.() ?? 0}`
  await launchctl(["bootout", domain, target])
  try {
    fs.rmSync(target, { force: true })
  } catch {
    // ignore
  }
  console.log(`av monitor uninstalled (${LAUNCH_AGENT_LABEL}).`)
}

export async function agentStatus(): Promise<string> {
  if (!isMacOS()) return "av monitor: launchd is macOS-only; status unavailable."
  const lines: string[] = []
  const target = plistPath()
  lines.push(`plist: ${fs.existsSync(target) ? target : "(not installed)"}`)

  const domain = `gui/${process.getuid?.() ?? 0}`
  const printed = await launchctl(["print", `${domain}/${LAUNCH_AGENT_LABEL}`])
  lines.push(`launchd: ${printed.ok ? "loaded" : "not loaded"}`)

  const pidFile = monitorPidFile()
  if (fs.existsSync(pidFile)) {
    const pid = parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10)
    let alive = false
    try { process.kill(pid, 0); alive = true } catch { alive = false }
    lines.push(`monitor pid: ${pid} (${alive ? "alive" : "dead"})`)
  } else {
    lines.push("monitor pid: (no pidfile)")
  }
  return lines.join("\n")
}
```

- [ ] **Step 2: Build**

Run: `bun run build`
Expected: no type errors.

- [ ] **Step 3: Manual smoke (side effects — not a unit test)**

On macOS, after Task 5 wires dispatch you will verify end-to-end. For now just confirm the module type-checks. (No unit test for launchctl calls — they are side-effectful and excluded from CI per the spec.)

- [ ] **Step 4: Commit**

```bash
git add src/core/launchd.ts
git commit -m "feat(monitor): launchd install/uninstall/status helpers"
```

---

### Task 4: Monitor runtime (pidfile singleton + run loop)

**Files:**
- Create: `src/core/monitor.ts`
- Test: `src/core/monitor.test.ts`

**Interfaces:**
- Consumes: `monitorPidFile` (Task 2); `getStorage` from `@/core/storage`; `getSessionManager` from `@/core/session`.
- Produces:
  - `acquireLock(pidfilePath: string, isAlive?: (pid: number) => boolean): { acquired: boolean; existingPid?: number }`
  - `async runMonitor(): Promise<void>`
- Consumed by Task 5 (`index.ts` dispatch of `{ type: "monitor" }`).

- [ ] **Step 1: Write the failing test for the lock**

Create `src/core/monitor.test.ts`:

```ts
import { test, expect } from "bun:test"
import { acquireLock } from "./monitor"
import * as fs from "fs"
import os from "os"
import path from "path"

function tmpFile(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "av-mon-")), "monitor.pid")
}

test("acquires when pidfile is missing", () => {
  const f = tmpFile()
  const res = acquireLock(f, () => true)
  expect(res.acquired).toBe(true)
  expect(fs.readFileSync(f, "utf8").trim()).toBe(String(process.pid))
})

test("refuses when a live monitor pid is present", () => {
  const f = tmpFile()
  fs.writeFileSync(f, "999999")
  const res = acquireLock(f, (pid) => pid === 999999) // pretend it is alive
  expect(res.acquired).toBe(false)
  expect(res.existingPid).toBe(999999)
})

test("acquires over a stale (dead) pidfile", () => {
  const f = tmpFile()
  fs.writeFileSync(f, "999999")
  const res = acquireLock(f, () => false) // dead
  expect(res.acquired).toBe(true)
  expect(fs.readFileSync(f, "utf8").trim()).toBe(String(process.pid))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/core/monitor.test.ts`
Expected: FAIL — module `./monitor` not found.

- [ ] **Step 3: Implement `acquireLock` and `runMonitor`**

Create `src/core/monitor.ts`:

```ts
import * as fs from "fs"
import * as path from "path"
import { monitorPidFile } from "./launchd"
import { getStorage } from "./storage"
import { getSessionManager } from "./session"

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function acquireLock(
  pidfilePath: string,
  isAlive: (pid: number) => boolean = isProcessAlive
): { acquired: boolean; existingPid?: number } {
  if (fs.existsSync(pidfilePath)) {
    const raw = fs.readFileSync(pidfilePath, "utf8").trim()
    const pid = parseInt(raw, 10)
    if (!isNaN(pid) && pid !== process.pid && isAlive(pid)) {
      return { acquired: false, existingPid: pid }
    }
  }
  fs.mkdirSync(path.dirname(pidfilePath), { recursive: true })
  fs.writeFileSync(pidfilePath, String(process.pid))
  return { acquired: true }
}

export async function runMonitor(): Promise<void> {
  const pidFile = monitorPidFile()
  const lock = acquireLock(pidFile)
  if (!lock.acquired) {
    console.log(`av monitor: already running (pid ${lock.existingPid}); exiting.`)
    return
  }

  const storage = getStorage()
  const manager = getSessionManager()

  // Only job: run the status refresh loop. The monitor never attaches to a
  // session, so its event loop is never blocked by spawnSync — unlike the TUI.
  manager.startRefreshLoop(1000)
  console.log("av monitor: started (refresh loop @1000ms).")

  let shuttingDown = false
  const shutdown = () => {
    if (shuttingDown) return
    shuttingDown = true
    console.log("av monitor: shutting down.")
    try { manager.stopRefreshLoop() } catch {}
    try { storage.unregisterInstance() } catch {}
    try {
      if (fs.existsSync(pidFile) && fs.readFileSync(pidFile, "utf8").trim() === String(process.pid)) {
        fs.rmSync(pidFile, { force: true })
      }
    } catch {}
    try { storage.close() } catch {}
    process.exit(0)
  }
  process.on("SIGTERM", shutdown)
  process.on("SIGINT", shutdown)

  // Keep the process alive. The setInterval inside startRefreshLoop already
  // holds the event loop open; this promise never resolves until a signal
  // triggers process.exit in shutdown().
  await new Promise<void>(() => {})
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/core/monitor.test.ts`
Expected: PASS (all three lock tests). `runMonitor` is not unit-tested (long-running side effects).

- [ ] **Step 5: Build**

Run: `bun run build`
Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/core/monitor.ts src/core/monitor.test.ts
git commit -m "feat(monitor): headless run loop with pidfile singleton"
```

---

### Task 5: Wire dispatch in index.ts

**Files:**
- Modify: `src/index.ts` (`main()` dispatch, around the `web`/`all` branches at `:288-325`)

**Interfaces:**
- Consumes: `runMonitor` (Task 4); `installAgent`, `uninstallAgent`, `agentStatus` (Task 3); the `monitor` / `monitor-ctl` `CLICommand` variants (Task 1).

- [ ] **Step 1: Add the `monitor` dispatch branch**

In `src/index.ts` `main()`, add after the `command.type === "tui"` branch (`:288-296`) and before the `web` branch:

```ts
  if (command.type === "monitor") {
    try {
      const { runMonitor } = await import("./core/monitor")
      await runMonitor()
    } catch (error) {
      console.error("Fatal error:", error)
      process.exit(1)
    }
    return
  }

  if (command.type === "monitor-ctl") {
    try {
      const { installAgent, uninstallAgent, agentStatus } = await import("./core/launchd")
      if (command.action === "install") await installAgent()
      else if (command.action === "uninstall") await uninstallAgent()
      else console.log(await agentStatus())
    } catch (error) {
      console.error("Fatal error:", error)
      process.exit(1)
    }
    return
  }
```

- [ ] **Step 2: Build**

Run: `bun run build`
Expected: PASS with no errors (the two new `CLICommand` variants are now handled; any exhaustiveness error from Task 1 is resolved).

- [ ] **Step 3: Smoke-test the headless commands**

Run:
```bash
bun run src/index.ts --help | grep -i monitor
bun run src/index.ts monitor status
```
Expected: help shows the two monitor lines; `monitor status` prints a report (on macOS: plist/launchd/pid lines; elsewhere: the macOS-only message).

- [ ] **Step 4: Smoke-test the monitor loop briefly**

Run (foreground, then Ctrl-C after a few seconds):
```bash
bun run src/index.ts --monitor
```
Expected: prints "av monitor: started (refresh loop @1000ms)."; while running, `~/.agent-orchestrator/monitor.pid` exists and the `heartbeats` table gains a row; Ctrl-C prints "shutting down." and removes the pidfile.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts
git commit -m "feat(monitor): dispatch --monitor and monitor install/uninstall/status"
```

---

### Task 6: Auto-install wiring in install scripts

**Files:**
- Modify: `install.sh` (after the symlink setup near `:255-262`, before the final success echo at `:309`)
- Modify: `scripts/install-local.ts` (after Step 5 re-sign, before the final success logs)
- Modify: `uninstall.sh` (in `main()`, before removing binaries)

**Interfaces:**
- Consumes: the `av monitor install` / `av monitor uninstall` CLI (Tasks 1, 3, 5).

- [ ] **Step 1: install.sh — auto-install the agent on macOS**

In `install.sh`, add before the closing success message (`:309` area), after `av`/`agent-view` are linked:

```bash
# Install the macOS status-monitor LaunchAgent so session status stays fresh
# even when no TUI is open or the TUI is attached inside a session.
if [[ "$OSTYPE" == darwin* ]]; then
    if "$INSTALL_DIR/av" monitor install >/dev/null 2>&1; then
        echo -e "  ${GREEN}Status monitor installed (launchd)${NC}"
    else
        echo -e "  ${YELLOW}Could not install status monitor (run 'av monitor install' manually)${NC}"
    fi
fi
```

(Use the same `$INSTALL_DIR` / color vars the script already defines. `$INSTALL_DIR` here is the bin dir holding `av`; confirm against the script's own usage and adjust the path to the `av` entry if it differs.)

- [ ] **Step 2: install-local.ts — auto-install on darwin**

In `scripts/install-local.ts`, after the macOS re-sign block (Step 5) and before the final `console.log` success lines, add:

```ts
// Install/refresh the macOS status-monitor LaunchAgent.
if (process.platform === "darwin") {
  console.log("🛰  Installing status monitor (launchd)...")
  try {
    await $`${LOCAL_AV} monitor install`
  } catch (e) {
    console.warn("⚠️  Could not install status monitor; run 'av monitor install' manually.")
  }
}
```

(`LOCAL_AV` is already defined in the script at the top.)

- [ ] **Step 3: uninstall.sh — remove the agent first**

In `uninstall.sh` `main()`, add before the "Remove binaries" block:

```bash
  # Remove the status-monitor LaunchAgent (macOS) while av is still present.
  if [[ "$OSTYPE" == darwin* ]] && [ -x "$BIN_DIR/av" ]; then
    log "Removing status monitor (launchd)..."
    "$BIN_DIR/av" monitor uninstall >/dev/null 2>&1 || true
  fi
```

- [ ] **Step 4: Build + verify install-local end-to-end (macOS)**

Run:
```bash
bun run install-local
launchctl print "gui/$(id -u)/com.agent-view.monitor" >/dev/null 2>&1 && echo "LOADED" || echo "NOT LOADED"
av monitor status
```
Expected: install-local prints the "Installing status monitor" line; `LOADED`; `av monitor status` shows plist installed, launchd loaded, and a live monitor pid.

- [ ] **Step 5: Verify the fix (the actual bug)**

Attach into a session and stay in it; from another terminal run `av --list --json` a few times over ~10s and confirm a session's status updates (e.g. a running agent shows `running`, not frozen). Confirm `heartbeats` is non-empty with the monitor pid as primary.

- [ ] **Step 6: Commit**

```bash
git add install.sh scripts/install-local.ts uninstall.sh
git commit -m "feat(monitor): auto-install launchd agent via install scripts"
```

---

### Task 7: Documentation

**Files:**
- Modify: `README.md` (Menu-bar Widget section, `:200-210`)

**Interfaces:** none (docs only).

- [ ] **Step 1: Document the monitor under the menu-bar section**

In `README.md`, after the existing note at `:210` ("Statuses stay live only while an agent-view instance … is running."), add:

```markdown
On macOS, the installer sets up a tiny **status monitor** (a launchd
LaunchAgent, `com.agent-view.monitor`) that keeps your session statuses fresh
even when no TUI is open or the TUI is busy attached inside a session. Manage it
with:

​```bash
av monitor status      # is it installed / loaded / running?
av monitor install     # (re)install the LaunchAgent
av monitor uninstall   # remove it
​```
```

(Remove the zero-width space before each closing/opening code fence — it is only here to avoid nesting confusion. Use real triple backticks.)

- [ ] **Step 2: Fix the stale "statuses stay live only while…" caveat**

Immediately after the block added in Step 1, soften the earlier caveat so it no longer reads as always-true on macOS — adjust the sentence at `:210` to:

```markdown
Without the monitor (e.g. on Linux), statuses stay live only while an
agent-view instance (the TUI or `av --web`) is running.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document the macOS status monitor"
```

---

## Self-Review

**Spec coverage:**
- CLI surface (`--monitor`, `monitor <action>`, help) → Task 1. ✓
- Monitor runtime (pidfile singleton, `startRefreshLoop(1000)`, signal shutdown) → Task 4. ✓
- launchd plist (label, ProgramArguments, RunAtLoad, KeepAlive, log path) → Task 2. ✓
- launchd install/uninstall/status + av-path resolution + macOS guard → Task 3. ✓
- Dispatch → Task 5. ✓
- Install/uninstall/install-local wiring (macOS auto, idempotent, non-fatal) → Task 6. ✓
- Logging to `~/.agent-orchestrator/monitor.log` → via plist in Task 2 (StandardOut/ErrPath) + Task 5 startup/shutdown prints. ✓
- Testing: args, buildPlist, pidfile lock → Tasks 1, 2, 4; manual side-effect checks → Tasks 5, 6. ✓
- README docs → Task 7. ✓
- No `AppConfig` field added — honored (no task touches config). ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N" — all steps carry concrete code. ✓

**Type consistency:** `monitorPidFile`/`monitorLogFile`/`plistPath`/`buildPlist`/`LAUNCH_AGENT_LABEL` (Task 2) are used verbatim in Tasks 3–4. `acquireLock`/`runMonitor` (Task 4) match Task 5's import. `installAgent`/`uninstallAgent`/`agentStatus` (Task 3) match Task 5's import. `CLICommand` variants `{type:"monitor"}` / `{type:"monitor-ctl";action}` consistent across Tasks 1 and 5. ✓
