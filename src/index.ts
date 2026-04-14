/**
 * Agent Orchestrator
 * OpenTUI-based Agent Management
 */

import { parseArgs, printHelp } from "./cli/args"
import type { CLICommand } from "./cli/args"
import pkg from "../package.json"
import { execFile, spawn } from "child_process"
import { promisify } from "util"
import * as fsSync from "fs"
import * as fs from "fs/promises"
import * as path from "path"
import { getConfigDir, ensureConfigDir } from "./core/config"

const execFileAsync = promisify(execFile)

async function executeHeadlessCommand(command: CLICommand): Promise<void> {
  // Lazy import to avoid loading TUI dependencies for headless commands
  const { cmdNew, cmdList, cmdDelete, cmdStop, cmdRestart, cmdAttach, cmdStatus, cmdInfo, cmdSend, cmdAcknowledge, cmdConfirm, cmdInterrupt, cmdOutput, cmdHibernate, cmdWake, cmdAutoHibernate } = await import("./cli/commands")

  switch (command.type) {
    case "new":
      await cmdNew(command.options)
      break
    case "list":
      await cmdList(command.options)
      break
    case "delete":
      await cmdDelete(command.id, command.worktree, command.force)
      break
    case "stop":
      await cmdStop(command.id)
      break
    case "restart":
      await cmdRestart(command.id)
      break
    case "attach":
      await cmdAttach(command.id)
      break
    case "status":
      await cmdStatus(command.id)
      break
    case "info":
      await cmdInfo(command.id, command.json)
      break
    case "send":
      await cmdSend(command.id, command.message)
      break
    case "acknowledge":
      await cmdAcknowledge(command.id)
      break
    case "confirm":
      await cmdConfirm(command.id)
      break
    case "interrupt":
      await cmdInterrupt(command.id)
      break
    case "output":
      await cmdOutput(command.id, command.lines)
      break
    case "hibernate":
      await cmdHibernate(command.id)
      break
    case "wake":
      await cmdWake(command.id)
      break
    case "auto-hibernate":
      await cmdAutoHibernate(command.minutes)
      break
  }
}

async function launchTUI(mode: "light" | "dark"): Promise<void> {
  const { tui } = await import("./tui/app")
  await tui({
    mode,
    onExit: async () => {
      console.log("Goodbye!")
    }
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getWebPidFile(port: number): string {
  return path.join(getConfigDir(), `web-${port}.pid`)
}

function getWebLogFile(port: number): string {
  return path.join(getConfigDir(), `web-${port}.log`)
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function readWebPid(port: number): Promise<number | null> {
  try {
    const content = await fs.readFile(getWebPidFile(port), "utf-8")
    const pid = Number.parseInt(content.trim(), 10)
    return Number.isFinite(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

async function writeWebPid(port: number, pid: number): Promise<void> {
  await ensureConfigDir()
  await fs.writeFile(getWebPidFile(port), `${pid}\n`, "utf-8")
}

async function clearWebPid(port: number): Promise<void> {
  try {
    await fs.unlink(getWebPidFile(port))
  } catch {
    // ignore
  }
}

async function stopExistingWeb(port: number): Promise<void> {
  const existingPid = await readWebPid(port)
  if (!existingPid) return
  if (!isProcessAlive(existingPid)) {
    await clearWebPid(port)
    return
  }

  try {
    process.kill(existingPid, "SIGTERM")
  } catch {
    // ignore
  }

  for (let i = 0; i < 10; i++) {
    await sleep(200)
    if (!isProcessAlive(existingPid)) break
  }

  if (isProcessAlive(existingPid)) {
    try {
      process.kill(existingPid, "SIGKILL")
    } catch {
      // ignore
    }
  }
  await clearWebPid(port)
}

async function isWebHealthy(port: number): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 1200)
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: controller.signal })
    if (!res.ok) return false
    const body = await res.json() as { ok?: boolean }
    return body.ok === true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

async function ensureTailscaleServe(port: number): Promise<void> {
  try {
    await execFileAsync("tailscale", ["serve", "--bg", String(port)], { timeout: 10000 })
    const { stdout } = await execFileAsync("tailscale", ["serve", "status"], { timeout: 10000 })
    const httpsUrl = stdout.split("\n").find((line) => line.trim().startsWith("https://"))
    if (httpsUrl) {
      console.log(`Tailscale URL: ${httpsUrl.trim()}`)
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.warn(`Warning: tailscale serve setup failed (${msg})`)
  }
}

function getWebSpawnCommand(host: string, port: number): { cmd: string; args: string[] } {
  const baseArgs = ["--web", "--host", host, "--port", String(port), "--no-serve"]
  const scriptPath = process.argv[1]

  if (scriptPath && (scriptPath.endsWith(".ts") || scriptPath.endsWith(".js"))) {
    return { cmd: process.execPath, args: [scriptPath, ...baseArgs] }
  }

  return { cmd: process.execPath, args: baseArgs }
}

async function ensureWebBackground(host: string, port: number, noServe: boolean): Promise<void> {
  const alreadyUp = await isWebHealthy(port)
  if (alreadyUp) {
    console.log(`Web backend already running on :${port}`)
    if (!noServe) await ensureTailscaleServe(port)
    return
  }

  const existingPid = await readWebPid(port)
  if (existingPid && isProcessAlive(existingPid)) {
    for (let i = 0; i < 5; i++) {
      await sleep(300)
      if (await isWebHealthy(port)) {
        console.log(`Web backend already running on :${port}`)
        if (!noServe) await ensureTailscaleServe(port)
        return
      }
    }
    console.log(`Web backend process already exists (pid ${existingPid}), skip duplicate start`)
    if (!noServe) await ensureTailscaleServe(port)
    return
  }
  if (existingPid) {
    await clearWebPid(port)
  }

  const { cmd, args } = getWebSpawnCommand(host, port)
  await ensureConfigDir()
  const logFd = fsSync.openSync(getWebLogFile(port), "a")
  const child = spawn(cmd, args, {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: process.env
  })
  if (typeof child.pid === "number" && child.pid > 0) {
    await writeWebPid(port, child.pid)
  }
  child.unref()
  fsSync.closeSync(logFd)

  let started = false
  for (let i = 0; i < 10; i++) {
    await sleep(300)
    if (await isWebHealthy(port)) {
      started = true
      break
    }
  }
  if (started) {
    console.log(`Web backend started on :${port}`)
  } else {
    console.warn(`Warning: web backend did not become healthy on :${port}`)
    console.warn(`Check log: ${getWebLogFile(port)}`)
  }

  if (!noServe) {
    await ensureTailscaleServe(port)
  }
}

async function restartWebBackground(host: string, port: number, noServe: boolean): Promise<void> {
  await stopExistingWeb(port)
  await ensureWebBackground(host, port, noServe)
}

async function main() {
  const command = parseArgs(process.argv)

  if (command.type === "help") {
    printHelp()
    process.exit(0)
  }

  if (command.type === "version") {
    console.log(`agent-view v${pkg.version}`)
    process.exit(0)
  }

  if (command.type === "tui") {
    try {
      await launchTUI(command.mode)
    } catch (error) {
      console.error("Fatal error:", error)
      process.exit(1)
    }
    return
  }

  if (command.type === "web") {
    try {
      if (command.daemon) {
        if (command.restartWeb) {
          await restartWebBackground(command.host, command.port, command.noServe)
        } else {
          await ensureWebBackground(command.host, command.port, command.noServe)
        }
        console.log(`Web backend running in background on :${command.port}`)
        console.log(`Log file: ${getWebLogFile(command.port)}`)
        return
      }
      if (command.restartWeb) {
        await stopExistingWeb(command.port)
      }
      if (!command.noServe) {
        await ensureTailscaleServe(command.port)
      }
      const { startWebServer } = await import("./web/server")
      await startWebServer({ host: command.host, port: command.port })
    } catch (error) {
      console.error("Fatal error:", error)
      process.exit(1)
    }
    return
  }

  if (command.type === "all") {
    try {
      if (command.restartWeb) {
        await restartWebBackground(command.host, command.port, command.noServe)
      } else {
        await ensureWebBackground(command.host, command.port, command.noServe)
      }
      await launchTUI(command.mode)
    } catch (error) {
      console.error("Fatal error:", error)
      process.exit(1)
    }
    return
  }

  // Headless command
  try {
    await executeHeadlessCommand(command)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`Error: ${message}\n`)
    process.exit(1)
  }
}

main()
