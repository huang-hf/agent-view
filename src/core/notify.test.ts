import { describe, expect, test } from "bun:test"
import type { Session } from "./types"
import { NotifyRuntime } from "./notify"

function makeSession(overrides: Partial<Session>): Session {
  return {
    id: "s-1",
    title: "demo",
    projectPath: "/tmp/demo",
    groupPath: "default",
    order: 0,
    command: "claude",
    wrapper: "",
    tool: "claude",
    status: "idle",
    tmuxSession: "tmux-demo",
    createdAt: new Date(0),
    lastAccessed: new Date(0),
    parentSessionId: "",
    worktreePath: "",
    worktreeRepo: "",
    worktreeBranch: "",
    toolData: {},
    acknowledged: false,
    remoteHost: "",
    ...overrides,
  }
}

describe("NotifyRuntime", () => {
  test("only triggers when entering waiting", () => {
    const rt = new NotifyRuntime({ cooldownSeconds: 300 })

    const first = rt.collectWaitingEntries([makeSession({ status: "idle" })], 1000)
    expect(first).toHaveLength(0)

    const second = rt.collectWaitingEntries([makeSession({ status: "waiting" })], 1001)
    expect(second).toHaveLength(1)

    const third = rt.collectWaitingEntries([makeSession({ status: "waiting" })], 1002)
    expect(third).toHaveLength(0)
  })

  test("no action marks token handled without command", async () => {
    const rt = new NotifyRuntime({ cooldownSeconds: 0 })
    const events = rt.collectWaitingEntries([makeSession({ status: "waiting" })], 1000)
    const token = events[0]!.actionToken

    const sent: string[] = []
    const result = await rt.handleAction({
      token,
      action: "no",
      sendYes: async (sessionId: string) => {
        sent.push(sessionId)
      },
    }, 1001)

    expect(result.ok).toBe(true)
    expect(sent).toHaveLength(0)
  })

  test("yes action sends confirmation exactly once", async () => {
    const rt = new NotifyRuntime({ cooldownSeconds: 0 })
    const events = rt.collectWaitingEntries([makeSession({ status: "waiting" })], 1000)
    const token = events[0]!.actionToken

    const sent: string[] = []
    const first = await rt.handleAction({
      token,
      action: "yes",
      sendYes: async (sessionId: string) => {
        sent.push(sessionId)
      },
    }, 1001)
    expect(first.ok).toBe(true)
    expect(sent).toEqual(["s-1"])

    const second = await rt.handleAction({
      token,
      action: "yes",
      sendYes: async () => {
        throw new Error("should not run twice")
      },
    }, 1002)
    expect(second.ok).toBe(false)
  })
})
