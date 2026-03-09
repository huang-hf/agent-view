# SSH Remote Session Management — Design Doc

**Date:** 2026-03-06
**Status:** Approved

---

## Goal

Allow a single agent-view instance to manage both local and remote Claude Code sessions.
Remote servers only need `tmux` + `claude` installed — no agent-view required on the server.

---

## Architecture

```
Local agent-view TUI
       │
       ├── LocalTmuxExecutor  ──► tmux -L agent-view ...  (local, unchanged)
       │
       └── SshTmuxExecutor   ──► SSH ControlMaster socket
                                       │
                                   ssh <alias> tmux -L agent-view ...  (remote)
```

A `TmuxExecutor` interface abstracts command execution. All existing logic in
`tmux.ts` (capturePane, sendKeys, refreshSessionCache, parseToolStatus) is
unchanged — they just call through the executor instead of directly spawning
local processes.

---

## SSH Authentication

Auth is fully delegated to `~/.ssh/config`. agent-view stores only an **alias**
that maps to an SSH config Host entry.

Example `~/.ssh/config` entry:
```
Host gpu-3090
    HostName     71.178.110.3
    Port         21209
    User         huifeng.huang
    IdentityFile ~/Downloads/3090_host.id_rsa
```

**No passwords or private key paths are stored in agent-view config.**
All auth methods (key, SSH agent, certificate) work transparently via SSH itself.

---

## Configuration

### `~/.agent-view/config.json` — new `remoteHosts` field

```json
{
  "remoteHosts": [
    { "alias": "gpu-3090",  "label": "3090 GPU Server" },
    { "alias": "cloud-1",   "label": "Cloud Instance"  }
  ]
}
```

- `alias` — must match a `Host` entry in `~/.ssh/config`
- `label` — optional display name shown in TUI (defaults to alias)

### TypeScript types

```ts
interface RemoteHost {
  alias: string    // SSH config Host alias
  label?: string   // Display name (optional)
}

interface Config {
  // ...existing fields
  remoteHosts?: RemoteHost[]
}
```

---

## Data Model

### Session — new `remoteHost` field

```ts
interface Session {
  // ...existing fields
  remoteHost: string   // SSH alias; empty string = local
}
```

SQLite migration: add column `remote_host TEXT NOT NULL DEFAULT ''`.

---

## SSH ControlMaster

Each remote host maintains one persistent SSH connection via ControlMaster,
so subsequent commands reuse the socket (no repeated handshakes, ~10–50ms latency).

**Connection command:**
```bash
ssh -o ControlMaster=auto \
    -o ControlPath=~/.agent-view/ssh-ctl/%h_%p_%r.sock \
    -o ControlPersist=60 \
    -fN <alias>
```

**Reuse pattern for each tmux command:**
```bash
ssh -o ControlMaster=no \
    -o ControlPath=~/.agent-view/ssh-ctl/%h_%p_%r.sock \
    <alias> tmux -L agent-view <args...>
```

### Connection lifecycle

| Event | Action |
|-------|--------|
| App starts | Pre-connect all configured remoteHosts (lazy: on first use) |
| Poll tick | `ssh -O check` to verify socket alive; reconnect if dead |
| App exits | `ssh -O stop` to close all ControlMaster sockets |
| Host unreachable | Mark sessions as `offline`, show indicator in TUI |

---

## New File: `src/core/ssh.ts`

Responsibilities:
- Manage ControlMaster lifecycle (connect, check, stop)
- Expose `SshTmuxExecutor` implementing the `TmuxExecutor` interface
- Track connection state per host (`connecting | connected | offline`)

### TmuxExecutor interface (new abstraction in `tmux.ts`)

```ts
interface TmuxExecutor {
  exec(args: string[]): Promise<{ stdout: string; stderr: string }>
  execFile(args: string[]): Promise<void>
  spawnAttach(sessionName: string): void   // for full-screen attach
}
```

`LocalTmuxExecutor` wraps existing `execAsync(tmuxCmd(...))` and `execFileAsync("tmux", tmuxSpawnArgs(...))`.
`SshTmuxExecutor` wraps `execFileAsync("ssh", [controlPathArgs, alias, "tmux", "-L", "agent-view", ...args])`.

---

## TUI Changes

### Home screen — session list

Remote sessions display the host label/alias as a prefix tag:

```
[gpu-3090] swift-fox   waiting   ~/projects/myapp
[gpu-3090] bold-hawk   running   ~/projects/api
           calm-deer   idle      /home/user/repo
```

Connection status indicator in header or group header:
- `●` connected
- `○` offline / unreachable
- `…` connecting

### New Session dialog

Add a "Host" field above the existing fields:
```
Host:    [ Local          ▼ ]   (dropdown: Local | gpu-3090 | cloud-1)
Tool:    [ claude         ▼ ]
Title:   [                  ]
Path:    [                  ]
```

When a remote host is selected:
- Worktree option is **hidden** (not supported for remote in MVP)
- Path refers to the remote server's filesystem

### Attach (Enter key)

For remote sessions, instead of local PTY attach:
```bash
ssh -t -o ControlPath=... <alias> tmux -L agent-view attach-session -t <name>
```

Ctrl+Q to detach and return to TUI works identically (tmux handles it).

### Settings dialog

New "Remote Hosts" section (press `c` → Remote Hosts):
- List configured hosts with connection status
- Add host: input alias + optional label
- Remove host
- Test connection button

---

## Status Polling

`SessionManager.refreshStatuses()` groups sessions by host and polls each
host's executor independently:

```
for each host (local + remotes):
  executor = getExecutor(host)
  await executor.exec(["list-windows", "-a", "-F", "..."])  // refresh cache
  for each session on this host:
    output = await executor.exec(["capture-pane", ...])
    status = parseToolStatus(output, session.tool)          // unchanged
    storage.writeStatus(session.id, status, session.tool)
```

If a host is offline, all its sessions are marked with a special `offline`
status (new SessionStatus value) rather than crashing the poll loop.

---

## MVP Scope (out of scope for v1)

| Feature | Reason |
|---------|--------|
| Remote worktree creation | Requires remote git operations |
| Remote session fork | Depends on local Claude session files |
| Remote memory monitoring | `ps` tree walk is expensive over SSH |
| Password auth (interactive) | ControlMaster requires non-interactive; use key auth |
| Multiple tmux sockets on remote | Assumes single `agent-view` socket on remote |

---

## File Changes Summary

| File | Change |
|------|--------|
| `src/core/types.ts` | Add `RemoteHost`, add `remoteHost` to `Session`, add `"offline"` to `SessionStatus` |
| `src/core/config.ts` | Add `remoteHosts?: RemoteHost[]` to `Config` |
| `src/core/tmux.ts` | Extract `TmuxExecutor` interface; `LocalTmuxExecutor` wraps existing code |
| `src/core/ssh.ts` | **New file** — ControlMaster management + `SshTmuxExecutor` |
| `src/core/session.ts` | `SessionManager` uses executor per session's `remoteHost` |
| `src/core/storage.ts` | Migration: add `remote_host` column to sessions table |
| `src/tui/routes/home.tsx` | Show host tag on remote sessions; connection status indicators |
| `src/tui/component/dialog-new.tsx` | Add Host selector field |
| `src/tui/component/dialog-settings.tsx` | Add Remote Hosts management section |
