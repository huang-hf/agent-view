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
- **Session Management** - Create, stop, restart, delete, and duplicate coding agent sessions with keyboard shortcuts
- **Git Worktree Integration** - Automatically create isolated git worktrees for each agent session, keeping your branches clean
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
| `Ctrl+T` | Toggle terminal pane (open/close) |
| `Ctrl+B` then `o` | Toggle focus between panes (tmux default) |
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

### Configuration

Create `~/.agent-view/config.json` to customize defaults:

```json
{
  "defaultTool": "claude",
  "worktree": {
    "defaultBaseBranch": "main",
    "command": "git worktree"
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
