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

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

export function buildPlist(avPath: string): string {
  const log = esc(monitorLogFile())
  const escAvPath = esc(avPath)
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escAvPath}</string>
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

// Resolve the real av binary. If the running executable is the compiled
// binary (named `agent-view` or `av`), use its real path. Otherwise (e.g. running
// under bun) fall back to the installed ~/.local/bin/av or
// ~/.agent-view/bin/agent-view, and finally to process.execPath.
export function resolveAvPath(): string {
  const base = path.basename(process.execPath)
  if (base === "agent-view" || base === "av") {
    try {
      return fs.realpathSync(process.execPath)
    } catch {
      // fall through to candidates
    }
  }
  const candidates = [
    path.join(os.homedir(), ".local", "bin", "av"),
    path.join(os.homedir(), ".agent-view", "bin", "agent-view"),
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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export async function installAgent(): Promise<boolean> {
  if (!isMacOS()) {
    console.log("av monitor: launchd is macOS-only; skipping agent install.")
    return true
  }
  const target = plistPath()
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.mkdirSync(path.join(os.homedir(), ".agent-orchestrator"), { recursive: true })
  fs.writeFileSync(target, buildPlist(resolveAvPath()))

  const domain = `gui/${process.getuid?.() ?? 0}`
  const service = `${domain}/${LAUNCH_AGENT_LABEL}`
  // Reload idempotently: bootout any existing instance (ignore failure),
  // wait for teardown to finish, then bootstrap with retries.
  await launchctl(["bootout", domain, target])
  for (let i = 0; i < 20; i++) {
    const printed = await launchctl(["print", service])
    if (!printed.ok) break
    await sleep(250)
  }

  let res = await launchctl(["bootstrap", domain, target])
  for (let attempt = 0; attempt < 5 && !res.ok; attempt++) {
    if (!(/(^|\s)5:/.test(res.output) || res.output.includes("Input/output error"))) break
    await sleep(500)
    res = await launchctl(["bootstrap", domain, target])
  }
  if (!res.ok) {
    console.error(`av monitor: launchctl bootstrap failed: ${res.output}`)
    return false
  }
  console.log(`av monitor installed (${LAUNCH_AGENT_LABEL}).`)
  return true
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
    if (isNaN(pid) || pid <= 0) {
      lines.push("monitor pid: (invalid pidfile)")
    } else {
      let alive = false
      try { process.kill(pid, 0); alive = true } catch (e: any) { alive = e?.code === "EPERM" }
      lines.push(`monitor pid: ${pid} (${alive ? "alive" : "dead"})`)
    }
  } else {
    lines.push("monitor pid: (no pidfile)")
  }
  return lines.join("\n")
}
