import { describe, test, expect } from "bun:test"
import {
  addCurrentSessionId,
  removeCurrentSessionId,
  pruneCurrentSessionIds,
  selectCurrentSessions
} from "./session"
import type { Session } from "@/core/types"

function createMockSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "test-id",
    title: "Test Session",
    projectPath: "/test/path",
    groupPath: "",
    order: 0,
    command: "claude",
    wrapper: "",
    tool: "claude",
    status: "idle",
    tmuxSession: "test-tmux",
    createdAt: new Date("2024-01-01T10:00:00Z"),
    lastAccessed: new Date("2024-01-01T10:00:00Z"),
    parentSessionId: "",
    worktreePath: "",
    worktreeRepo: "",
    worktreeBranch: "",
    toolData: {},
    acknowledged: false,
    ...overrides,
  }
}

describe("addCurrentSessionId", () => {
  test("prepends new ids and preserves existing positions", () => {
    expect(addCurrentSessionId(["a", "b"], "c")).toEqual(["c", "a", "b"])
    expect(addCurrentSessionId(["a", "b"], "b")).toEqual(["a", "b"])
  })

  test("trims from the tail at the limit", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `s${i}`)
    expect(addCurrentSessionId(ids, "new")).toEqual(["new", "s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"])
  })
})

describe("removeCurrentSessionId", () => {
  test("removes only the matching id", () => {
    expect(removeCurrentSessionId(["a", "b", "c"], "b")).toEqual(["a", "c"])
  })
})

describe("pruneCurrentSessionIds", () => {
  test("drops ids with no matching session, keeps order, and dedupes", () => {
    const sessions = [
      createMockSession({ id: "a" }),
      createMockSession({ id: "c" }),
    ]
    expect(pruneCurrentSessionIds(["a", "missing", "c", "a"], sessions)).toEqual(["a", "c"])
  })

  test("does NOT filter by status — hibernated/stopped ids are kept", () => {
    const sessions = [
      createMockSession({ id: "hib", status: "hibernated" }),
      createMockSession({ id: "stop", status: "stopped" }),
      createMockSession({ id: "off", status: "offline" }),
    ]
    expect(pruneCurrentSessionIds(["hib", "stop", "off"], sessions)).toEqual(["hib", "stop", "off"])
  })
})

describe("selectCurrentSessions", () => {
  test("resolves ids to sessions in id order, skipping deleted", () => {
    const sessions = [
      createMockSession({ id: "b", title: "B" }),
      createMockSession({ id: "a", title: "A" }),
    ]
    const result = selectCurrentSessions(["a", "gone", "b"], sessions)
    expect(result.map(s => s.id)).toEqual(["a", "b"])
  })

  test("keeps sessions regardless of status", () => {
    const sessions = [
      createMockSession({ id: "hib", status: "hibernated" }),
      createMockSession({ id: "run", status: "running" }),
    ]
    const result = selectCurrentSessions(["hib", "run"], sessions)
    expect(result.map(s => s.id)).toEqual(["hib", "run"])
  })
})
