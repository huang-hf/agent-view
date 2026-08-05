/**
 * Opens the user's editor ($EDITOR, vim, nano, vi) for editing task text.
 *
 * Runs the editor directly in the current terminal with inherited stdio, so it
 * works whether or not av is attached to a tmux session. The caller MUST
 * suspend the OpenTUI renderer around this call (renderer.suspend()/resume())
 * so the editor gets exclusive control of the terminal.
 */

import fs from "fs"
import os from "os"
import path from "path"
import { spawnSync } from "child_process"
import { resolveScratchpadEditor } from "./scratchpad"

/**
 * Opens the editor on a temp file seeded with initialText and returns the saved
 * content, or null if the result is empty. The caller decides what to do with
 * null (discard new task, keep old text for edits, etc.).
 */
export async function openTaskEditor(taskId: string, initialText: string): Promise<string | null> {
  const editor = resolveScratchpadEditor()
  if (!editor) {
    throw new Error("No editor found. Set $EDITOR or install vim.")
  }

  const tmpPath = path.join(os.tmpdir(), `av-task-${taskId}.txt`)

  try {
    fs.writeFileSync(tmpPath, initialText, { mode: 0o600 })

    const result = spawnSync(editor, [tmpPath], { stdio: "inherit" })
    if (result.error) {
      throw result.error
    }

    const content = fs.readFileSync(tmpPath, "utf-8")
    return content.trim() === "" ? null : content
  } finally {
    try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
  }
}
