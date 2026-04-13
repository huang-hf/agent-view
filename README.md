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
- **Session Management** - Create, stop, restart, and delete coding agent sessions with keyboard shortcuts
- **Mobile Web UI** - Focus-first web client for phone usage with group/session switcher and remote support
- **Git Worktree Integration** - Automatically create isolated git worktrees for each agent session, keeping your branches clean
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

# Expose on LAN/Tailscale (auto tailscale serve)
av --web --host 0.0.0.0 --port 4317

# Start TUI + ensure web backend + tailscale serve
av --all --host 0.0.0.0 --port 4317
```

Then open `http://<host>:4317`.

`av --all` is idempotent for web startup: if the web backend is already running on the target port, it will reuse it instead of restarting.

#### Web UI highlights

- Focus-first single-session view optimized for phone usage
- Top switcher with two-step `Group -> Session` navigation
- Unified local + remote sessions in one UI
- Inbox for waiting/error sessions
- Paged transcript browsing (latest 1000 lines, scroll up to load older)
- Quick actions:
  - `Quick Confirm` (send Enter)
  - `Interrupt (Esc Esc)` (send Escape twice)
- Notifications with Service Worker support (`Enable Notifications` + `Test Notification`)

#### Secure phone access with Tailscale

If you already use Tailscale, you can expose the local web UI over your tailnet:

```bash
tailscale serve --bg 4317
tailscale serve status
```

This gives you a tailnet-only HTTPS URL such as `https://<device>.<tailnet>.ts.net/`.

### Mobile Access Scenario (Tailscale)

Use this when you want to manage sessions from your phone outside working hours.

#### 1) Prerequisites

- Tailscale is installed and logged in on both PC and phone
- PC and phone are in the same tailnet
- `av` is running on your PC

#### 2) Start Agent View Web UI on PC

```bash
av --all --host 0.0.0.0 --port 4317
```

This starts TUI and ensures the web backend is running.  
Why `0.0.0.0`: it allows access from your Tailscale interface (not only localhost).

#### 3) Expose it as HTTPS inside tailnet

`av --web` / `av --all` already try to run `tailscale serve --bg <port>` automatically.

You can still verify manually:

```bash
tailscale serve status
```

You should get a URL like:

```text
https://<device>.<tailnet>.ts.net/
```

If Serve is not enabled on your tailnet, Tailscale will print an enable link. Open it once, then re-run `tailscale serve --bg 4317`.

#### 4) Open on phone

Open the HTTPS Tailscale URL in your mobile browser (Edge/Chrome/Safari).

- Recommended: use the `https://...ts.net` URL from `tailscale serve status`
- Not recommended for notifications: `http://<tailscale-ip>:4317`

#### 5) Enable notifications

In Web UI:

1. Tap `Enable Notifications`
2. Tap `Test Notification`

If permission is granted, you should see a system notification banner.

#### 6) Daily mobile workflow

- Open top switcher -> choose `Group` -> choose `Session`
- Use `Quick Confirm` to send Enter for waiting prompts
- Use `Interrupt (Esc Esc)` to interrupt current execution
- Scroll transcript upward to load older output (latest 1000 lines window)

#### 7) Common issues

- **No notification banner on phone**
  - Verify site notification permission is `Allow`
  - Verify system notification permission for browser app is enabled
  - Use HTTPS Tailscale URL (`https://...ts.net`)
- **Phone can't open URL**
  - Check both devices are connected to Tailscale
  - Verify web UI process is running on PC
  - Re-check `tailscale serve status`
- **Need to disable serve**

```bash
tailscale serve --https=443 off
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
| `f` | Fork session |
| `F` | Fork session with worktree |
| `s` | Open shortcuts dialog |
| `g` | Create new group |
| `m` | Move session to group |
| `1-9` | Jump to group by number |
| `Ctrl+K` | Open command palette |
| `?` | Show help |
| `q` | Quit |

**Inside attached session:**

| Key | Action |
|-----|--------|
| `Ctrl+K` | Detach and open command palette |
| `Ctrl+T` | Toggle terminal pane (open/close) |
| `Ctrl+O` | Toggle focus between panes |
| `Ctrl+Q` | Detach (return to dashboard) |

### Create a Session

1. Press `n` to open the new session dialog
2. Select your AI tool (Claude, Gemini, OpenCode, etc.)
3. Enter the project path
4. Optionally enable git worktree for an isolated branch
5. Press `Enter` to create and attach

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

## Remote Sessions

Manage AI coding sessions running on remote machines (dev boxes, cloud VMs, etc.) from your local Agent View dashboard.

### Setup

1. Install `av` on the remote machine
2. Ensure SSH access is configured (key-based auth recommended)
3. Press `Shift+N` to create a remote session

### Creating Remote Sessions

Press `Shift+N` to open the remote session wizard:

1. **SSH Host** - Enter the SSH destination (e.g., `user@hostname` or an SSH config name)
2. **av Path** - Path to `av` binary on remote (default: `av`)
3. **Tool** - Select the AI tool to use
4. **Project Path** - Working directory on the remote machine
5. **Title** - Optional session name

Values are remembered for next time.

## Requirements

- [Bun](https://bun.sh) runtime
- [tmux](https://github.com/tmux/tmux) for session management
- At least one AI coding tool installed (claude, gemini, opencode, etc.)
- For remote sessions: SSH access to remote host with `av` installed

## Acknowledgments

This project is inspired by [agent-deck](https://github.com/asheshgoplani/agent-deck).

## License

MIT
