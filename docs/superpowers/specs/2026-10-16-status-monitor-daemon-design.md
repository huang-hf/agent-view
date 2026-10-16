# Status Monitor Daemon — Design

**Date:** 2026-10-16
**Status:** Approved (design)
**Topic:** Decouple session status refresh from the TUI/web process via an always-on headless monitor, launchd-managed on macOS.

## Problem

Session status detection (polling tmux, deriving `running`/`waiting`/`idle`,
writing back to SQLite) lives in `SessionManager.startRefreshLoop()`
(`src/core/session.ts:270`). That loop only runs inside a live `av` process
(TUI or `av --web`). A multi-instance "register → heartbeat → elect primary"
scheme (`registerInstance`/`heartbeat`/`electPrimary`) ensures exactly one
writer, but it still presupposes that *some* `av` process is alive and running
its event loop.

Two failure modes freeze status, making consumers (the SwiftBar menu-bar
widget, `av --list --json`, the web API) read a stale DB snapshot:

1. **No `av` running at all** — no primary, nothing refreshes.
2. **`av` running but attached into a session (the common case).** Local attach
   goes `LocalTmuxExecutor.spawnAttach` → `attachSessionSync` → `spawnSync`
   (`src/core/tmux.ts:54-56`, `:943-966`). `spawnSync` **blocks the Bun event
   loop** for the entire time the user is inside the session, so the
   `setInterval` refresh loop never fires — no status detection, no heartbeat
   (the `heartbeats` table goes empty). Since the user lives inside sessions
   most of the time, status is frozen for long stretches.

Observed in production: an `av` alive for ~18h, attached into a session, with an
empty `heartbeats` table and a DB whose statuses were stale (`running 1`,
`stopped 3` that no longer matched reality).

## Goal

Keep session status fresh **independent of whether a TUI/web `av` is open and
independent of whether it is blocked by an attach**, so the menu-bar widget and
every other DB consumer always reflect reality.

Non-goals (YAGNI): fixing the blocking `spawnSync` attach itself (delicate
terminal-handoff code; the monitor sidesteps it); Linux/systemd support (defer
until requested); a web server or any UI in the monitor.

## Approach (chosen: A)

Add a tiny headless process `av --monitor` whose only job is to run the refresh
loop and stay alive. Because it never attaches to a session, its event loop is
never blocked by `spawnSync`, so its heartbeat and status detection run
continuously. Manage its lifecycle with a macOS launchd LaunchAgent
(`RunAtLoad` + `KeepAlive`) so it survives login and crashes.

This single mechanism covers **both** failure modes above, and reuses the
existing primary-election code so a concurrently-open TUI/web does not
double-write.

## Components

### 1. CLI surface

- `src/cli/args.ts`: `parseArgs` gains:
  - `{ type: "monitor" }` for `av --monitor`.
  - A `monitor` subcommand group for lifecycle management, parsed from
    `av monitor <action>` where `action ∈ { install, uninstall, status }`:
    `{ type: "monitor-ctl", action }`.
- `src/cli/args.test.ts`: cover `--monitor` and each `monitor <action>`.
- Help text (`printHelp`) documents `--monitor` and `av monitor install|uninstall|status`.

### 2. Monitor runtime

New module `src/core/monitor.ts` exporting `runMonitor()`:

1. Acquire a singleton lock via pidfile `~/.agent-orchestrator/monitor.pid`:
   - If the file holds a live pid (`process.kill(pid, 0)` succeeds) **and** that
     pid is a monitor, log "monitor already running (pid N)" and exit 0.
   - Otherwise write our own pid (stale/missing file is overwritten).
2. Initialize storage (`getStorage()`), get `getSessionManager()`.
3. `manager.startRefreshLoop(1000)` — **1000ms** interval (TUI/web use 500ms;
   the monitor runs 24/7 so a lower rate halves polling while staying ahead of
   the widget's 3s refresh).
4. Keep the process alive (the `setInterval` keeps the event loop busy; no
   explicit idle timer needed).
5. On `SIGTERM`/`SIGINT`: `manager.stopRefreshLoop()`, remove the pidfile, close
   storage, exit 0.

`index.ts` `main()` dispatches `command.type === "monitor"` → `await runMonitor()`.

The monitor participates in primary election exactly like the TUI/web
(`startRefreshLoop` already calls `storage.registerInstance(false)` and
heartbeats). No change to election logic. When both a monitor and a TUI run, one
is elected primary; the other stands by. Correctness does not depend on *which*
wins — only that one writer exists, which the monitor now guarantees whenever
the TUI is attached/blocked or absent.

### 3. launchd integration

New module `src/core/launchd.ts` (macOS-only helpers, pure where possible):

- `LAUNCH_AGENT_LABEL = "com.agent-view.monitor"`
- `plistPath()` → `~/Library/LaunchAgents/com.agent-view.monitor.plist`
- `buildPlist(avPath: string): string` — **pure**, returns the plist XML:
  - `Label` = label
  - `ProgramArguments` = `[avPath, "--monitor"]`
  - `RunAtLoad` = true, `KeepAlive` = true
  - `StandardOutPath` / `StandardErrorPath` = `~/.agent-orchestrator/monitor.log`
- `installAgent()`:
  - Resolve the absolute `av` path (prefer the real binary behind the
    `av`/`agent-view` symlink; fall back to `process.execPath`).
  - Write plist, then `launchctl bootout gui/<uid> <plist>` (ignore failure) and
    `launchctl bootstrap gui/<uid> <plist>` to (re)load idempotently.
- `uninstallAgent()`: `launchctl bootout gui/<uid> <plist>` (ignore "not found"),
  then delete the plist.
- `agentStatus()`: report (a) plist present?, (b) `launchctl print`/`list` shows
  the label loaded?, (c) monitor pid alive per pidfile?, (d) current primary.

On non-macOS, the `monitor-ctl` actions print a clear "only supported on macOS"
message and exit 0 (so install.sh stays portable).

### 4. Install / uninstall flow

- `av monitor install|uninstall|status` → call the launchd helpers above.
- `install.sh`: after the binary + symlinks are in place, on macOS
  (`$OSTYPE == darwin*`) run `"$INSTALL_DIR/av" monitor install` (idempotent;
  non-fatal if it fails — print a warning, don't abort the install).
- `scripts/install-local.ts`: after install, on darwin invoke
  `av monitor install` so local dev builds get the fix too.
- `uninstall.sh`: run `av monitor uninstall` before removing the binary.

No `AppConfig` field is added (keeps scope tight and avoids the settings-dialog
obligation). The agent is managed entirely via the `monitor` subcommand +
launchctl.

### 5. Logging

- Monitor writes to `~/.agent-orchestrator/monitor.log` (via the launchd stdio
  redirect). Internal `log()` calls already gate on `AV_DEBUG_LOG`; the plist
  does **not** set `AV_DEBUG_LOG`, so the log stays quiet — only
  startup/shutdown and one-line errors print unconditionally.

## Data flow

```
launchd (RunAtLoad/KeepAlive)
  └─ av --monitor  (never attaches; event loop always live)
       └─ SessionManager.startRefreshLoop(1000)
            ├─ registerInstance + heartbeat   → heartbeats table
            ├─ electPrimary                    → this process wins when TUI is blocked/absent
            └─ refreshStatuses()               → writes sessions.status in SQLite
                                                   ▲
SwiftBar plugin / av --list / web API ──────────── reads fresh DB
```

## Error handling

- **Duplicate monitor:** pidfile singleton check → second instance exits 0.
  launchd itself keeps a single instance per label; the pidfile is the
  defense-in-depth + uninstall handle.
- **Stale pidfile** (monitor crashed): `process.kill(pid, 0)` throws → treated as
  dead → overwritten. KeepAlive relaunches.
- **launchctl failures during install:** surfaced to the user by `monitor
  install`; in install.sh they are non-fatal warnings so the rest of the install
  completes.
- **tmux listing hiccup:** already handled inside `refreshStatuses` (preserves
  prior statuses on a failed cycle) — unchanged.
- **Non-macOS:** `monitor-ctl` actions no-op with a message; `--monitor` itself
  still works (so a Linux user could wire their own systemd unit manually).

## Testing

Unit (bun test):
- `args.test.ts`: `--monitor` → `{ type: "monitor" }`; `monitor install` /
  `uninstall` / `status` → `{ type: "monitor-ctl", action }`; bad/missing action
  handled.
- `launchd.test.ts`: `buildPlist(avPath)` produces well-formed XML containing the
  label, `[avPath, "--monitor"]`, `RunAtLoad`, `KeepAlive`, and the log path.
- `monitor.test.ts`: pidfile singleton logic — fresh write when missing/stale;
  detect-and-exit when a live pid is present (mock `process.kill`).

Manual (side-effectful, not in CI):
- `av monitor install` → `launchctl print gui/$(id -u)/com.agent-view.monitor`
  shows it loaded; `~/Library/LaunchAgents/...plist` exists.
- Attach into a session and leave it; confirm the SwiftBar widget keeps updating
  (status changes) and `heartbeats` is non-empty with the monitor as primary.
- `av monitor uninstall` → label gone, plist removed.
- Reboot → monitor comes back (RunAtLoad); `kill` the monitor pid → KeepAlive
  relaunches it.

## Files touched

- `src/cli/args.ts` (+ `args.test.ts`) — parse `--monitor`, `monitor <action>`.
- `src/index.ts` — dispatch `monitor` + `monitor-ctl`.
- `src/core/monitor.ts` (new, + `monitor.test.ts`) — `runMonitor()`, pidfile.
- `src/core/launchd.ts` (new, + `launchd.test.ts`) — plist build + install/uninstall/status.
- `install.sh`, `uninstall.sh`, `scripts/install-local.ts` — wire auto (un)install on macOS.
- `README.md` — document the monitor under the menu-bar section.

## Rollout

Existing users get the monitor the next time they run `install.sh` or
`bun run install-local`. The SwiftBar plugin and `av --list` are unchanged —
they simply start seeing a continuously-fresh DB.
