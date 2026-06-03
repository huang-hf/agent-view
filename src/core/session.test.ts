import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { SessionManager } from "./session"
import { localExecutor } from "./tmux"
import { Storage, setStorage } from "./storage"
import type { Session } from "./types"

let testStorage: Storage | null = null
let tempRoot = ""

function makeSession(overrides: Partial<Session> = {}): Session {
  const now = new Date("2026-05-14T00:00:00.000Z")
  return {
    id: "session-123",
    title: "demo",
    projectPath: "/tmp/project",
    groupPath: "default",
    order: 0,
    command: "claude",
    wrapper: "",
    tool: "claude",
    status: "running",
    tmuxSession: "agentorch_demo",
    createdAt: now,
    lastAccessed: now,
    parentSessionId: "",
    worktreePath: "",
    worktreeRepo: "",
    worktreeBranch: "",
    toolData: {},
    acknowledged: false,
    ...overrides
  }
}

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-view-session-test-"))
  testStorage = new Storage({ dbPath: path.join(tempRoot, "state.db") })
  testStorage.migrate()
  setStorage(testStorage)
})

afterEach(() => {
  mock.restore()
  testStorage?.close()
  testStorage = null
  setStorage(null as unknown as Storage)
  if (tempRoot) {
    fs.rmSync(tempRoot, { recursive: true, force: true })
    tempRoot = ""
  }
})

describe("SessionManager.attach", () => {
  test("updates lastAccessed before attaching", async () => {
    const initialLastAccessed = new Date("2026-05-13T00:00:00.000Z")
    const session = makeSession({ lastAccessed: initialLastAccessed })
    testStorage!.saveSession(session)

    const attachSpy = spyOn(localExecutor, "spawnAttach").mockImplementation(() => {})

    const manager = new SessionManager()
    await manager.attach(session.id)

    expect(attachSpy).toHaveBeenCalledWith(session.tmuxSession, { sessionId: session.id })
    expect(testStorage!.getSession(session.id)!.lastAccessed.getTime()).toBeGreaterThan(initialLastAccessed.getTime())
  })
})
