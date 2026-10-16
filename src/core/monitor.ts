import * as fs from "fs"
import * as path from "path"
import { monitorPidFile } from "./launchd"
import { getStorage } from "./storage"
import { getSessionManager } from "./session"

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function acquireLock(
  pidfilePath: string,
  isAlive: (pid: number) => boolean = isProcessAlive
): { acquired: boolean; existingPid?: number } {
  if (fs.existsSync(pidfilePath)) {
    const raw = fs.readFileSync(pidfilePath, "utf8").trim()
    const pid = parseInt(raw, 10)
    if (!isNaN(pid) && pid > 0 && pid !== process.pid && isAlive(pid)) {
      return { acquired: false, existingPid: pid }
    }
  }
  fs.mkdirSync(path.dirname(pidfilePath), { recursive: true })
  fs.writeFileSync(pidfilePath, String(process.pid))
  return { acquired: true }
}

export async function runMonitor(): Promise<void> {
  const pidFile = monitorPidFile()
  const lock = acquireLock(pidFile)
  if (!lock.acquired) {
    console.log(`av monitor: already running (pid ${lock.existingPid}); exiting.`)
    return
  }

  const storage = getStorage()
  const manager = getSessionManager()

  // Only job: run the status refresh loop. The monitor never attaches to a
  // session, so its event loop is never blocked by spawnSync — unlike the TUI.
  manager.startRefreshLoop(1000)
  console.log("av monitor: started (refresh loop @1000ms).")

  let shuttingDown = false
  const shutdown = () => {
    if (shuttingDown) return
    shuttingDown = true
    console.log("av monitor: shutting down.")
    try { manager.stopRefreshLoop() } catch {}
    try { storage.unregisterInstance() } catch {}
    try {
      if (fs.existsSync(pidFile) && fs.readFileSync(pidFile, "utf8").trim() === String(process.pid)) {
        fs.rmSync(pidFile, { force: true })
      }
    } catch {}
    try { storage.close() } catch {}
    process.exit(0)
  }
  process.on("SIGTERM", shutdown)
  process.on("SIGINT", shutdown)

  // One bad refresh cycle must not kill the daemon.
  process.on("unhandledRejection", (e) => console.error("av monitor: unhandled rejection", e))
  process.on("uncaughtException", (e) => console.error("av monitor: uncaught exception", e))

  // Keep the process alive. The setInterval inside startRefreshLoop already
  // holds the event loop open; this promise never resolves until a signal
  // triggers process.exit in shutdown().
  await new Promise<void>(() => {})
}
