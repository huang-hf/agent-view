import fs from "fs"
import os from "os"
import path from "path"
import { spawnSync } from "child_process"

const BASE_DIR = path.join(os.homedir(), ".agent-view")
const SCRATCHPAD_DIRNAME = "scratchpads"

function getScratchpadRoot(baseDir = BASE_DIR): string {
  return path.join(baseDir, SCRATCHPAD_DIRNAME)
}

export function getScratchpadPath(sessionId: string, baseDir = BASE_DIR): string {
  return path.join(getScratchpadRoot(baseDir), `${sessionId}.md`)
}

export function ensureScratchpad(sessionId: string, baseDir = BASE_DIR): string {
  const dir = getScratchpadRoot(baseDir)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })

  const filePath = getScratchpadPath(sessionId, baseDir)
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, "", { mode: 0o600 })
  }

  return filePath
}

export function deleteScratchpad(sessionId: string, baseDir = BASE_DIR): void {
  const filePath = getScratchpadPath(sessionId, baseDir)
  try {
    fs.unlinkSync(filePath)
  } catch {
    // Ignore if the file is already absent.
  }
}

function commandExists(command: string): boolean {
  const result = spawnSync("which", [command], { stdio: "ignore" })
  return result.status === 0
}

export function resolveScratchpadEditor(
  env: NodeJS.ProcessEnv = process.env,
  exists: (command: string) => boolean = commandExists
): string | null {
  const preferred = env.EDITOR?.trim()
  if (preferred && exists(preferred)) {
    return preferred
  }

  for (const fallback of ["vim", "nano", "vi"]) {
    if (exists(fallback)) {
      return fallback
    }
  }

  return null
}
