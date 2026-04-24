import { describe, expect, test } from "bun:test"
import {
  buildScratchpadPopupCommand,
  buildScratchpadPopupKeyBinding,
  parseToolStatus,
} from "./tmux"

describe("parseToolStatus codex waiting detection", () => {
  test("does not treat normal assistant text as waiting", () => {
    const output = [
      "• Some normal output",
      "",
      "Do you want to allow me to run `tmux capture-pane` against the local socket?",
      "",
      "› Summarize recent commits",
    ].join("\n")

    expect(parseToolStatus(output, "codex").isWaiting).toBe(false)
  })

  test("detects explicit Codex approval UI cues", () => {
    const output = [
      "Approval required",
      "",
      "Run command?",
      "[y/N]",
    ].join("\n")

    expect(parseToolStatus(output, "codex").isWaiting).toBe(true)
  })
})

describe("parseToolStatus generic waiting detection", () => {
  test("detects interactive prompts for non-codex tools", () => {
    const output = "Do you want to continue? (y/n)"
    expect(parseToolStatus(output, "shell").isWaiting).toBe(true)
  })
})

describe("scratchpad popup helpers", () => {
  test("builds a tmux popup command for a session scratchpad file", () => {
    const command = buildScratchpadPopupCommand({
      filePath: "/tmp/session-a.md",
      editor: "nano",
    })

    expect(command).toContain("display-popup")
    expect(command).toContain("-w 70%")
    expect(command).toContain("-h 70%")
    expect(command).toContain("nano")
    expect(command).toContain("/tmp/session-a.md")
  })

  test("builds a Ctrl+T key binding that opens the popup", () => {
    const binding = buildScratchpadPopupKeyBinding({
      filePath: "/tmp/session-a.md",
      editor: "nano",
    })

    expect(binding).toContain("bind-key -n C-t")
    expect(binding).toContain("display-popup")
    expect(binding).toContain("/tmp/session-a.md")
  })

  test("builds a session-aware Ctrl+T binding from tmux options", () => {
    const binding = buildScratchpadPopupKeyBinding()

    expect(binding).toContain("bind-key -n C-t")
    expect(binding).toContain("#{@agent_view_scratchpad_editor}")
    expect(binding).toContain("#{@agent_view_scratchpad_path}")
  })
})
