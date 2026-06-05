import { describe, test, expect } from "bun:test"
import {
  addCurrentSessionId,
  getInitialCurrentSessionIds,
  getCurrentSessions,
  getCurrentSessionIdsAfterRefresh,
  normalizeCurrentSessionIds,
  removeCurrentSessionId,
  sortSessionsByCreatedAt
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

describe("sortSessionsByCreatedAt", () => {
  test("returns empty array for empty input", () => {
    expect(sortSessionsByCreatedAt([])).toEqual([])
  })

  test("returns single session unchanged", () => {
    const session = createMockSession({ id: "1" })
    const result = sortSessionsByCreatedAt([session])
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe("1")
  })

  test("sorts sessions by creation time, newest first", () => {
    const oldest = createMockSession({
      id: "oldest",
      createdAt: new Date("2024-01-01T10:00:00Z"),
    })
    const middle = createMockSession({
      id: "middle",
      createdAt: new Date("2024-01-02T10:00:00Z"),
    })
    const newest = createMockSession({
      id: "newest",
      createdAt: new Date("2024-01-03T10:00:00Z"),
    })

    const result = sortSessionsByCreatedAt([oldest, middle, newest])

    expect(result[0]!.id).toBe("newest")
    expect(result[1]!.id).toBe("middle")
    expect(result[2]!.id).toBe("oldest")
  })

  test("order is stable regardless of status", () => {
    const running = createMockSession({
      id: "running",
      status: "running",
      createdAt: new Date("2024-01-01T10:00:00Z"),
    })
    const waiting = createMockSession({
      id: "waiting",
      status: "waiting",
      createdAt: new Date("2024-01-02T10:00:00Z"),
    })
    const idle = createMockSession({
      id: "idle",
      status: "idle",
      createdAt: new Date("2024-01-03T10:00:00Z"),
    })

    const result = sortSessionsByCreatedAt([running, waiting, idle])

    // Order should be by creation time, not status
    expect(result[0]!.id).toBe("idle")
    expect(result[1]!.id).toBe("waiting")
    expect(result[2]!.id).toBe("running")
  })

  test("order is stable regardless of lastAccessed", () => {
    const recentlyAccessed = createMockSession({
      id: "recently-accessed",
      createdAt: new Date("2024-01-01T10:00:00Z"),
      lastAccessed: new Date("2024-01-10T10:00:00Z"),
    })
    const notRecentlyAccessed = createMockSession({
      id: "not-recently-accessed",
      createdAt: new Date("2024-01-02T10:00:00Z"),
      lastAccessed: new Date("2024-01-02T10:00:00Z"),
    })

    const result = sortSessionsByCreatedAt([recentlyAccessed, notRecentlyAccessed])

    // Order should be by creation time, not lastAccessed
    expect(result[0]!.id).toBe("not-recently-accessed")
    expect(result[1]!.id).toBe("recently-accessed")
  })

  test("does not mutate original array", () => {
    const sessions = [
      createMockSession({ id: "1", createdAt: new Date("2024-01-01") }),
      createMockSession({ id: "2", createdAt: new Date("2024-01-02") }),
    ]
    const original = [...sessions]

    sortSessionsByCreatedAt(sessions)

    expect(sessions[0]!.id).toBe(original[0]!.id)
    expect(sessions[1]!.id).toBe(original[1]!.id)
  })

  test("handles sessions with same creation time", () => {
    const sameTime = new Date("2024-01-01T10:00:00Z")
    const session1 = createMockSession({ id: "1", createdAt: sameTime })
    const session2 = createMockSession({ id: "2", createdAt: sameTime })

    const result = sortSessionsByCreatedAt([session1, session2])

    // Both should be present, order is implementation-defined for equal keys
    expect(result).toHaveLength(2)
    expect(result.map(s => s.id).sort()).toEqual(["1", "2"])
  })
})

describe("getCurrentSessions", () => {
  test("uses stored ids order instead of lastAccessed order", () => {
    const olderAccess = createMockSession({
      id: "first",
      lastAccessed: new Date("2024-01-01T10:00:00Z"),
    })
    const newerAccess = createMockSession({
      id: "second",
      lastAccessed: new Date("2024-01-03T10:00:00Z"),
    })

    const result = getCurrentSessions([newerAccess, olderAccess], { ids: ["first", "second"] })

    expect(result.map(s => s.id)).toEqual(["first", "second"])
  })

  test("returns active sessions sorted by last accessed newest first", () => {
    const oldest = createMockSession({
      id: "oldest",
      status: "idle",
      lastAccessed: new Date("2024-01-01T10:00:00Z"),
    })
    const newest = createMockSession({
      id: "newest",
      status: "running",
      lastAccessed: new Date("2024-01-03T10:00:00Z"),
    })
    const middle = createMockSession({
      id: "middle",
      status: "waiting",
      lastAccessed: new Date("2024-01-02T10:00:00Z"),
    })

    const result = getCurrentSessions([oldest, newest, middle])

    expect(result.map(s => s.id)).toEqual(["newest", "middle", "oldest"])
  })

  test("excludes stopped and hibernated sessions", () => {
    const sessions = [
      createMockSession({ id: "running", status: "running" }),
      createMockSession({ id: "waiting", status: "waiting" }),
      createMockSession({ id: "idle", status: "idle" }),
      createMockSession({ id: "stopped", status: "stopped" }),
      createMockSession({ id: "hibernated", status: "hibernated" }),
    ]

    const result = getCurrentSessions(sessions)

    expect(result.map(s => s.id).sort()).toEqual(["idle", "running", "waiting"])
  })

  test("limits results to ten sessions by default", () => {
    const sessions = Array.from({ length: 12 }, (_, i) => createMockSession({
      id: `session-${i}`,
      lastAccessed: new Date(Date.UTC(2024, 0, 1, 10, i)),
    }))

    const result = getCurrentSessions(sessions)

    expect(result).toHaveLength(10)
    expect(result[0]!.id).toBe("session-11")
    expect(result[9]!.id).toBe("session-2")
  })

  test("accepts a custom limit", () => {
    const sessions = Array.from({ length: 4 }, (_, i) => createMockSession({
      id: `session-${i}`,
      lastAccessed: new Date(Date.UTC(2024, 0, 1, 10, i)),
    }))

    const result = getCurrentSessions(sessions, { limit: 2 })

    expect(result.map(s => s.id)).toEqual(["session-3", "session-2"])
  })
})

describe("current session id helpers", () => {
  test("getInitialCurrentSessionIds uses persisted ids when present", () => {
    const sessions = [
      createMockSession({ id: "newer", lastAccessed: new Date("2024-01-02T10:00:00Z") }),
      createMockSession({ id: "older", lastAccessed: new Date("2024-01-01T10:00:00Z") }),
    ]

    expect(getInitialCurrentSessionIds(["older"], sessions)).toEqual(["older"])
    expect(getInitialCurrentSessionIds([], sessions)).toEqual([])
  })

  test("getInitialCurrentSessionIds seeds from sessions when persisted ids are missing", () => {
    const sessions = [
      createMockSession({ id: "older", lastAccessed: new Date("2024-01-01T10:00:00Z") }),
      createMockSession({ id: "newer", lastAccessed: new Date("2024-01-02T10:00:00Z") }),
    ]

    expect(getInitialCurrentSessionIds(undefined, sessions)).toEqual(["newer", "older"])
  })

  test("addCurrentSessionId prepends new ids and preserves existing positions", () => {
    expect(addCurrentSessionId(["a", "b"], "c")).toEqual(["c", "a", "b"])
    expect(addCurrentSessionId(["a", "b"], "b")).toEqual(["a", "b"])
  })

  test("addCurrentSessionId trims from the tail", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `s${i}`)

    expect(addCurrentSessionId(ids, "new")).toEqual(["new", "s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"])
  })

  test("removeCurrentSessionId removes only the matching id", () => {
    expect(removeCurrentSessionId(["a", "b", "c"], "b")).toEqual(["a", "c"])
  })

  test("normalizeCurrentSessionIds removes missing and inactive sessions", () => {
    const sessions = [
      createMockSession({ id: "idle", status: "idle" }),
      createMockSession({ id: "running", status: "running" }),
      createMockSession({ id: "stopped", status: "stopped" }),
      createMockSession({ id: "hibernated", status: "hibernated" }),
    ]

    const result = normalizeCurrentSessionIds(
      ["missing", "stopped", "idle", "hibernated", "running"],
      sessions
    )

    expect(result).toEqual(["idle", "running"])
  })

  test("getCurrentSessionIdsAfterRefresh preserves stored ids during incomplete refreshes", () => {
    const result = getCurrentSessionIdsAfterRefresh(
      ["a", "b"],
      [],
      { hasPersistedIds: true }
    )

    expect(result).toEqual(["a", "b"])
  })

  test("getCurrentSessionIdsAfterRefresh seeds ids only before config has persisted ids", () => {
    const sessions = [
      createMockSession({ id: "older", lastAccessed: new Date("2024-01-01T10:00:00Z") }),
      createMockSession({ id: "newer", lastAccessed: new Date("2024-01-02T10:00:00Z") }),
    ]

    const result = getCurrentSessionIdsAfterRefresh(
      [],
      sessions,
      { hasPersistedIds: false }
    )

    expect(result).toEqual(["newer", "older"])
  })
})
