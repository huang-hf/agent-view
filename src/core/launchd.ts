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
