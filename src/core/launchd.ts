import os from "os"
import path from "path"
import * as fs from "fs"
import { execFile } from "child_process"
import { promisify } from "util"

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
