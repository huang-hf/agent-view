/**
 * Simple CLI argument parser
 * No external dependencies - parses process.argv into structured commands
 */

export type CLICommand =
  | { type: "tui"; mode: "light" | "dark" }
  | { type: "web"; host: string; port: number }
  | { type: "help" }
  | { type: "version" }
  | { type: "new"; options: NewOptions }
  | { type: "list"; options: ListOptions }
  | { type: "delete"; id: string; worktree: boolean; force: boolean }
  | { type: "stop"; id: string }
  | { type: "restart"; id: string }
  | { type: "attach"; id: string }
  | { type: "status"; id: string }
  | { type: "info"; id: string; json: boolean }
  | { type: "send"; id: string; message: string }
  | { type: "confirm"; id: string }
  | { type: "interrupt"; id: string }
  | { type: "output"; id: string; lines: number }
  | { type: "hibernate"; id: string }
  | { type: "wake"; id: string }
  | { type: "auto-hibernate"; minutes?: number }

export interface NewOptions {
  path: string
  tool: string
  title?: string
  command?: string
  group?: string
  worktree: boolean
  branch?: string
  baseDevelop: boolean
  resume: boolean
  skipPermissions: boolean
}

export interface ListOptions {
  group?: string
  status?: string
  json: boolean
}

function getFlag(args: string[], flag: string): boolean {
  return args.includes(flag)
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag)
  if (idx === -1 || idx + 1 >= args.length) return undefined
  return args[idx + 1]
}

export function parseArgs(argv: string[]): CLICommand {
  const args = argv.slice(2)

  if (args.length === 0) {
    return { type: "tui", mode: "dark" }
  }

  if (getFlag(args, "--help") || getFlag(args, "-h")) {
    return { type: "help" }
  }

  if (getFlag(args, "--version") || getFlag(args, "-v")) {
    return { type: "version" }
  }

  if (getFlag(args, "--web")) {
    const host = getFlagValue(args, "--host") ?? "127.0.0.1"
    const portRaw = getFlagValue(args, "--port")
    const port = portRaw ? parseInt(portRaw, 10) : 4317
    if (isNaN(port) || port < 1 || port > 65535) {
      process.stderr.write("Error: --port must be a valid port number (1-65535)\n")
      process.exit(2)
    }
    return { type: "web", host, port }
  }

  if (getFlag(args, "--new") || getFlag(args, "-n")) {
    return {
      type: "new",
      options: {
        path: getFlagValue(args, "--path") ?? process.cwd(),
        tool: getFlagValue(args, "--tool") ?? "claude",
        title: getFlagValue(args, "--title"),
        command: getFlagValue(args, "--command"),
        group: getFlagValue(args, "--group"),
        worktree: getFlag(args, "--worktree"),
        branch: getFlagValue(args, "--branch"),
        baseDevelop: getFlag(args, "--base-develop"),
        resume: getFlag(args, "--resume"),
        skipPermissions: getFlag(args, "--skip-permissions"),
      },
    }
  }

  if (getFlag(args, "--list") || getFlag(args, "-l")) {
    return {
      type: "list",
      options: {
        group: getFlagValue(args, "--group"),
        status: getFlagValue(args, "--status"),
        json: getFlag(args, "--json"),
      },
    }
  }

  if (getFlag(args, "--delete")) {
    const id = getFlagValue(args, "--delete")
    if (!id) {
      process.stderr.write("Error: --delete requires a session ID or title\n")
      process.exit(2)
    }
    return {
      type: "delete",
      id,
      worktree: getFlag(args, "--worktree"),
      force: getFlag(args, "--force") || getFlag(args, "-f"),
    }
  }

  if (getFlag(args, "--stop")) {
    const id = getFlagValue(args, "--stop")
    if (!id) {
      process.stderr.write("Error: --stop requires a session ID or title\n")
      process.exit(2)
    }
    return { type: "stop", id }
  }

  if (getFlag(args, "--restart")) {
    const id = getFlagValue(args, "--restart")
    if (!id) {
      process.stderr.write("Error: --restart requires a session ID or title\n")
      process.exit(2)
    }
    return { type: "restart", id }
  }

  if (getFlag(args, "--attach") || getFlag(args, "-a")) {
    const id = getFlagValue(args, "--attach") ?? getFlagValue(args, "-a")
    if (!id) {
      process.stderr.write("Error: --attach requires a session ID or title\n")
      process.exit(2)
    }
    return { type: "attach", id }
  }

  if (getFlag(args, "--status")) {
    const id = getFlagValue(args, "--status")
    if (!id) {
      process.stderr.write("Error: --status requires a session ID or title\n")
      process.exit(2)
    }
    return { type: "status", id }
  }

  if (getFlag(args, "--send")) {
    const id = getFlagValue(args, "--send")
    if (!id) {
      process.stderr.write("Error: --send requires a session ID or title\n")
      process.exit(2)
    }
    // Everything after the ID is the message
    const idIdx = args.indexOf(id)
    const remaining = args.slice(idIdx + 1).filter(a => !a.startsWith("--"))
    const message = remaining.join(" ")
    if (!message) {
      process.stderr.write("Error: --send requires a message\n")
      process.exit(2)
    }
    return { type: "send", id, message }
  }

  if (getFlag(args, "--confirm")) {
    const id = getFlagValue(args, "--confirm")
    if (!id) {
      process.stderr.write("Error: --confirm requires a session ID or title\n")
      process.exit(2)
    }
    return { type: "confirm", id }
  }

  if (getFlag(args, "--interrupt")) {
    const id = getFlagValue(args, "--interrupt")
    if (!id) {
      process.stderr.write("Error: --interrupt requires a session ID or title\n")
      process.exit(2)
    }
    return { type: "interrupt", id }
  }

  if (getFlag(args, "--output")) {
    const id = getFlagValue(args, "--output")
    if (!id) {
      process.stderr.write("Error: --output requires a session ID or title\n")
      process.exit(2)
    }
    const linesRaw = getFlagValue(args, "--lines")
    const lines = linesRaw ? parseInt(linesRaw, 10) : 200
    if (isNaN(lines) || lines < 1) {
      process.stderr.write("Error: --lines must be a positive integer\n")
      process.exit(2)
    }
    return { type: "output", id, lines }
  }

  if (getFlag(args, "--info")) {
    const id = getFlagValue(args, "--info")
    if (!id) {
      process.stderr.write("Error: --info requires a session ID or title\n")
      process.exit(2)
    }
    return { type: "info", id, json: getFlag(args, "--json") }
  }

  if (getFlag(args, "--hibernate")) {
    const id = getFlagValue(args, "--hibernate")
    if (!id) {
      process.stderr.write("Error: --hibernate requires a session ID or title\n")
      process.exit(2)
    }
    return { type: "hibernate", id }
  }

  if (getFlag(args, "--wake")) {
    const id = getFlagValue(args, "--wake")
    if (!id) {
      process.stderr.write("Error: --wake requires a session ID or title\n")
      process.exit(2)
    }
    return { type: "wake", id }
  }

  if (getFlag(args, "--auto-hibernate")) {
    const value = getFlagValue(args, "--auto-hibernate")
    if (value !== undefined) {
      const minutes = parseInt(value, 10)
      if (isNaN(minutes) || minutes < 0) {
        process.stderr.write("Error: --auto-hibernate requires a non-negative number of minutes\n")
        process.exit(2)
      }
      return { type: "auto-hibernate", minutes }
    }
    return { type: "auto-hibernate" }
  }

  // Fallback: TUI mode with optional --light
  const mode = getFlag(args, "--light") ? "light" : "dark"
  return { type: "tui", mode }
}

export function printHelp(): void {
  console.log(`
Agent View - Terminal Agent Management

Usage:
  av [options]                    Launch TUI (default)
  av --web [--host H --port P]    Launch mobile web UI/API server
  av --new [flags]                Create a new session
  av --list [flags]               List sessions
  av --delete <id> [flags]        Delete a session
  av --stop <id>                  Stop a session
  av --restart <id>               Restart a session
  av --attach <id>                Attach to a session
  av --status <id>                Get session status
  av --info <id> [--json]         Get session details
  av --send <id> <message>        Send instructions to a running session
  av --confirm <id>               Send Enter to a waiting session
  av --interrupt <id>             Send Esc Esc to interrupt the current task
  av --output <id> [--lines N]    Show session output
  av --hibernate <id>             Hibernate a session (Claude-only)
  av --wake <id>                  Resume a hibernated session
  av --auto-hibernate [minutes]   Set/show auto-hibernate timeout (0 to disable)

TUI Options:
  --light                         Use light mode theme

Web Mode:
  --web                           Start web server (mobile-friendly UI + API)
  --host <addr>                   Bind address (default: 127.0.0.1)
  --port <port>                   Bind port (default: 4317)

New Session (--new, -n):
  --path <dir>                    Project path (default: cwd)
  --tool <name>                   Tool: claude|opencode|gemini|codex|custom|shell (default: claude)
  --title <name>                  Session title (default: auto-generated)
  --command <cmd>                 Custom command (requires --tool custom)
  --group <path>                  Group path (default: my-sessions)
  --worktree                      Create in git worktree
  --branch <name>                 Worktree branch name (requires --worktree)
  --base-develop                  Base worktree on develop branch
  --resume                        Resume existing Claude session
  --skip-permissions              Skip Claude permission prompts

List Sessions (--list, -l):
  --group <path>                  Filter by group
  --status <status>               Filter: running|waiting|idle|stopped|error|hibernated
  --json                          Output as JSON

Delete Session (--delete):
  --worktree                      Also delete the git worktree
  --force, -f                     Skip confirmation prompt

General:
  --lines <count>                 Used with --output (default: 200)
  --help, -h                      Show this help message
  --version, -v                   Show version
`)
}
