import fs from "fs"
import os from "os"
import path from "path"

const LOG_DIR = path.join(os.homedir(), ".agent-orchestrator")
const LOG_FILE = path.join(LOG_DIR, "debug.log")
const MAX_LOG_BYTES = 8 * 1024 * 1024
const MAX_BACKUPS = 3

function isEnabled(): boolean {
  const raw = (process.env.AV_DEBUG_LOG || "").trim().toLowerCase()
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on"
}

function ensureDir(): void {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true })
  } catch {
    // Ignore logging setup errors
  }
}

function rotateIfNeeded(): void {
  try {
    if (!fs.existsSync(LOG_FILE)) return
    const size = fs.statSync(LOG_FILE).size
    if (size < MAX_LOG_BYTES) return

    for (let i = MAX_BACKUPS; i >= 1; i--) {
      const src = `${LOG_FILE}.${i}`
      const dst = `${LOG_FILE}.${i + 1}`
      if (fs.existsSync(src)) {
        if (i === MAX_BACKUPS) fs.rmSync(src, { force: true })
        else fs.renameSync(src, dst)
      }
    }
    fs.renameSync(LOG_FILE, `${LOG_FILE}.1`)
  } catch {
    // Ignore rotation errors to avoid impacting runtime behavior
  }
}

export function debugLog(scope: string, ...args: unknown[]): void {
  if (!isEnabled()) return
  ensureDir()
  rotateIfNeeded()
  const msg = `[${new Date().toISOString()}] [${scope}] ${args.map((a) => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ")}\n`
  try {
    fs.appendFileSync(LOG_FILE, msg)
  } catch {
    // Ignore logging errors
  }
}
