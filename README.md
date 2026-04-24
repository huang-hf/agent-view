# Agent View

**A lightweight terminal-based agent orchestrator for managing multiple AI coding assistants.**

Run multiple AI coding agents in parallel and manage them from a single dashboard. Agent View is a lightweight tmux session manager built for AI-assisted development workflows - monitor agent status in real-time, get notifications when agents finish or need input, and seamlessly switch between sessions.

Works with **Claude Code**, **Gemini CLI**, **OpenCode**, **Codex CLI**, and any custom AI coding tool.

## Supported Platforms

| Platform | Architecture | Status |
|----------|--------------|--------|
| macOS    | Apple Silicon (arm64) | ✅ Supported |
| macOS    | Intel (x64) | ✅ Supported |
| Linux    | arm64 | ✅ Supported |
| Linux    | x64 | ✅ Supported |
| WSL      | x64 | ✅ Supported |

---

### ⭐ If you find this useful, please give it a star to help others discover it!

---

## Why Agent View?

When working with AI coding agents, you often need to run multiple agents on different tasks - one refactoring a module, another writing tests, a third exploring a bug. Agent View lets you orchestrate all of them from one place instead of juggling terminal tabs. It's the missing multi-agent management layer for your AI-assisted development workflow.

## Demo

![Demo](assets/demo.gif?v=2)

## Features

- **Multi-Agent Dashboard** - View all your AI coding assistant sessions at a glance with real-time status indicators
- **Smart Notifications** - Get notified when an agent finishes a task or needs your input, so you can context-switch efficiently
- **Mobile Web UI** - Focus-first web client for phone usage with inbox, transcript paging, and remote session support
- **Session Management** - Create, stop, restart, delete, and duplicate coding agent sessions with keyboard shortcuts
- **Git Worktree Integration** - Automatically create isolated git worktrees for each agent session, keeping your branches clean. Optionally sync with the latest remote branch before creating each worktree
- **Remote SSH Sessions** - Manage AI agent sessions on remote servers via SSH, with automatic reconnection and connection health monitoring
- **Tool Agnostic** - Works as a Claude Code manager, Gemini CLI orchestrator, OpenCode dashboard, or with any custom AI tool
- **Keyboard-First** - Fully navigable terminal UI with keyboard shortcuts for maximum productivity
- **Session Groups** - Organize sessions into groups by project or workflow
- **Persistent State** - Sessions survive terminal restarts and system reboots via tmux

### Status Detection

Agent View monitors your sessions and shows real-time status indicators:

| Status | Symbol | What It Means |
|--------|--------|---------------|
| **Running** | `●` green | Agent is actively working |
| **Waiting** | `◐` yellow | Needs your input |
| **Idle** | `○` gray | Ready for commands |
| **Stopped** | `◻` gray | Session was stopped |
| **Error** | `✗` red | Something went wrong |

## Installation

### Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/frayo44/agent-view/main/install.sh | bash
```

### Manual Install

```bash
git clone git@github.com:frayo44/agent-view.git
cd agent-view
bun install
bun run build
```

### Compile Standalone Binary

```bash
bun run compile        # Current platform
bun run compile:all    # All platforms (macOS/Linux, x64/arm64)
```

## Usage

### Start Agent View

```bash
agent-view
# or use the short alias
av
```

### Web UI (Mobile + Remote)

Start the web server:

```bash
# Local only
av --web --host 127.0.0.1 --port 4317 --no-serve

# Expose on Tailscale/LAN
av --web --host 0.0.0.0 --port 4317

# Background web daemon
av --web --host 0.0.0.0 --port 4317 --daemon

# Start TUI and ensure the web backend is running
av --all --host 0.0.0.0 --port 4317
```

Web UI highlights:

- Single-session mobile layout optimized for phone usage
- Inbox for waiting and error sessions
- Paged transcript browsing with upward loading
- Quick actions: `Confirm`, `Interrupt`, `Acknowledge`
- Browser notifications via Service Worker
- Unified local and remote session access

If you use Tailscale, `av --web` and `av --all` can automatically try `tailscale serve --bg <port>`.
You can verify the published HTTPS URL with:

```bash
tailscale serve status
```

### Keyboard Shortcuts

**Dashboard:**

| Key | Action |
|-----|--------|
| `n` | Create new session |
| `Enter` | Attach to session / toggle group |
| `↑/k` | Navigate up |
| `↓/j` | Navigate down |
| `→/l` | Expand group (or attach to session) |
| `←/h` | Collapse group |
| `d` | Delete session or group |
| `r` | Restart session |
| `R` | Rename session or group |
| `f` | Duplicate session (pre-fills new session dialog with same config) |
| `s` | Open shortcuts dialog |
| `g` | Create new group |
| `m` | Move session to group |
| `1-9` | Jump to group by number |
| `Ctrl+K` | Open command palette |
| `?` | Show help |
| `q` | Quit (with confirmation) |

**Inside attached session:**

| Key | Action |
|-----|--------|
| `Ctrl+K` | Detach and open command palette |
| `Ctrl+T` | Open session scratchpad popup |
| `Ctrl+Q` | Detach (return to dashboard) |

### Create a Session

1. Press `n` to open the new session dialog
2. Select your AI tool (Claude, Gemini, OpenCode, etc.)
3. Enter the project path
4. Optionally enable git worktree for an isolated branch
5. Press `Enter` to create and attach

### Remote SSH Sessions

Agent View can manage AI agent sessions on remote servers over SSH. Sessions run in tmux on the remote host and are monitored in real-time from your local dashboard.

Add remote hosts to `~/.agent-view/config.json`:

```json
{
  "remoteHosts": [
    { "alias": "my-server" },
    { "alias": "gpu-box", "label": "GPU" }
  ]
}
```

The `alias` must match an entry in your `~/.ssh/config`. When creating a new session, select the remote host from the host picker. Agent View will:
- Establish a persistent SSH ControlMaster connection
- Run tmux on the remote host using the same custom config
- Automatically reconnect if the SSH connection drops
- Detect connection health via SSH keepalives (auto-disconnect after 30s of silence)

When attaching to a remote session, the terminal shows a brief status line before tmux renders, and a "connection lost" message if the SSH connection drops while attached.

### Git Worktree Sync

When working in teams, your local `main` branch can fall behind. Enable `syncRemoteBranch` to automatically fetch the latest remote commits and base every new worktree on them:

```json
{
  "worktree": {
    "syncRemoteBranch": "origin/main"
  }
}
```

With this set, every time you create a new session (or duplicate an existing one with `f`), Agent View will:
1. Run `git fetch origin` against your repo
2. Create the new worktree branch from `origin/main` instead of your local HEAD

This ensures each new agent session starts from the latest code, without needing to manually pull first.

You can configure this from the TUI: press `c` to open Settings → **Worktree: sync remote branch**. Presets include `origin/main`, `origin/master`, `origin/develop`, or any custom remote branch.

> **Note:** The "Base on develop" checkbox in the new session dialog takes priority over `syncRemoteBranch` when checked.

### Configuration

Create `~/.agent-view/config.json` to customize defaults:

```json
{
  "defaultTool": "claude",
  "notify": {
    "enabled": true,
    "webhookUrl": "https://your-relay.example.com/agent-view/events",
    "webhookTokenEnv": "AV_NOTIFY_TOKEN",
    "cooldownSeconds": 300,
    "tokenTtlSeconds": 300,
    "pollIntervalMs": 500,
    "actionServer": {
      "enabled": true,
      "host": "127.0.0.1",
      "port": 5177,
      "path": "/notify/action",
      "secretEnv": "AV_NOTIFY_ACTION_SECRET"
    }
  },
  "worktree": {
    "defaultBaseBranch": "main",
    "syncRemoteBranch": "origin/main"
  },
  "shortcuts": [
    {
      "name": "Backend API",
      "tool": "claude",
      "projectPath": "/home/dev/projects/backend-api",
      "groupPath": "work",
      "keybind": "<leader>1"
    },
    {
      "name": "Frontend App",
      "tool": "gemini",
      "projectPath": "/home/dev/projects/frontend-app",
      "groupPath": "work",
      "keybind": "<leader>2"
    }
  ]
}
```

When `actionServer.enabled` is true, your relay can call back:

- `POST http://127.0.0.1:5177/notify/action`
- Headers: `x-av-secret: <value from AV_NOTIFY_ACTION_SECRET>`
- Body: `{ "token": "<actionToken>", "action": "yes" | "no" }`

Behavior:
- `yes`: sends `yes` + Enter to the target waiting session
- `no`: ignores this event (no input sent to the session)

**Shortcuts** allow quick session creation from pre-configured templates. Press `s` to open the shortcuts dialog, or use direct keybinds (e.g., `\1` for `<leader>1`).

| Shortcut Field | Required | Description |
|----------------|----------|-------------|
| `name` | Yes | Display name and session title |
| `tool` | Yes | `claude`, `gemini`, `opencode`, `codex`, `custom`, `shell` |
| `projectPath` | Yes | Working directory for the session |
| `groupPath` | Yes | Target group (created automatically if missing) |
| `keybind` | No | Direct keybind, e.g. `"<leader>1"`, `"ctrl+1"` |
| `command` | No | Custom command (required when `tool` is `custom`) |

## Requirements

- [Bun](https://bun.sh) runtime
- [tmux](https://github.com/tmux/tmux) for session management
- At least one AI coding tool installed (claude, gemini, opencode, etc.)

## Acknowledgments

This project is inspired by [agent-deck](https://github.com/asheshgoplani/agent-deck).

## License

MIT
