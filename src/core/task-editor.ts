/**
 * Opens a vim popup for editing task text via tmux display-popup.
 * Reuses the same mechanism as the scratchpad feature.
 */

import fs from "fs"
import os from "os"
import path from "path"
import { execFile } from "child_process"
import { promisify } from "util"
import { resolveScratchpadEditor } from "./scratchpad"

const execFileAsync = promisify(execFile)
const TMUX_SOCKET = "agent-view"

/**
 * Opens the user's editor ($EDITOR, vim, nano, vi) in a tmux display-popup
 * for editing the given text. Returns the saved content, or null if the user
 * quit without saving (file was empty or unchanged from empty).
 *
 * The caller is responsible for deciding what to do with null (discard new
 * task, keep old text for edits, etc.).
 */
export async function openTaskEditor(taskId: string, initialText: string): Promise<string | null> {
  const editor = resolveScratchpadEditor()
  if (!editor) {
    throw new Error("No editor found. Set $EDITOR or install vim.")
  }

  const tmpPath = path.join(os.tmpdir(), `av-task-${taskId}.txt`)

  try {
    fs.writeFileSync(tmpPath, initialText, { mode: 0o600 })

    await execFileAsync("tmux", [
      "-L", TMUX_SOCKET,
      "display-popup",
      "-w", "80%",
      "-h", "80%",
      "-E",
      `${editor} ${tmpPath}`,
    ])

    const content = fs.readFileSync(tmpPath, "utf-8")
    return content.trim() === "" ? null : content
  } finally {
    try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
  }
}
