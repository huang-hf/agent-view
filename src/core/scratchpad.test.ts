import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import {
  deleteScratchpad,
  ensureScratchpad,
  getScratchpadPath,
  resolveScratchpadEditor,
} from "./scratchpad"

const tempRoots: string[] = []

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-view-scratchpad-test-"))
  tempRoots.push(root)
  return root
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

describe("scratchpad storage", () => {
  test("resolves a per-session markdown scratchpad path", () => {
    const root = makeRoot()

    const filePath = getScratchpadPath("session-123", root)

    expect(filePath).toBe(path.join(root, "scratchpads", "session-123.md"))
  })

  test("creates the scratchpad directory and file lazily", () => {
    const root = makeRoot()

    const filePath = ensureScratchpad("session-123", root)

    expect(filePath).toBe(path.join(root, "scratchpads", "session-123.md"))
    expect(fs.existsSync(path.dirname(filePath))).toBe(true)
    expect(fs.existsSync(filePath)).toBe(true)
    expect(fs.readFileSync(filePath, "utf-8")).toBe("")
  })

  test("deletes the scratchpad file for a session", () => {
    const root = makeRoot()
    const filePath = ensureScratchpad("session-123", root)

    deleteScratchpad("session-123", root)

    expect(fs.existsSync(filePath)).toBe(false)
  })
})

describe("resolveScratchpadEditor", () => {
  test("prefers EDITOR when available", () => {
    const editor = resolveScratchpadEditor(
      { EDITOR: "helix" },
      (command) => command === "helix"
    )

    expect(editor).toBe("helix")
  })

  test("falls back to nano and then vi", () => {
    const nanoEditor = resolveScratchpadEditor({}, (command) => command === "nano")
    const viEditor = resolveScratchpadEditor({}, (command) => command === "vi")

    expect(nanoEditor).toBe("nano")
    expect(viEditor).toBe("vi")
  })

  test("returns null when no editor is available", () => {
    const editor = resolveScratchpadEditor({}, () => false)

    expect(editor).toBeNull()
  })
})
