/**
 * Cross-platform clipboard write utility
 */

import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

export async function copyToClipboard(text: string): Promise<void> {
  const platform = process.platform
  if (platform === "darwin") {
    await execAsync(`echo ${JSON.stringify(text)} | pbcopy`)
  } else {
    // Linux: try xclip, then xsel, then wl-copy (Wayland)
    try {
      await execAsync(`echo ${JSON.stringify(text)} | xclip -selection clipboard`)
    } catch {
      try {
        await execAsync(`echo ${JSON.stringify(text)} | xsel --clipboard --input`)
      } catch {
        await execAsync(`echo ${JSON.stringify(text)} | wl-copy`)
      }
    }
  }
}
