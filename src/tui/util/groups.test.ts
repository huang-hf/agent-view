import { describe, test, expect } from "bun:test"
import {
  flattenGroupTree,
  prependCurrentGroup,
  ensureDefaultGroup,
  getGroupSessionCount,
  getGroupStatusSummary,
  generateGroupPath,
  itemKey,
  resolveSelection,
  CURRENT_GROUP_PATH,
  CURRENT_GROUP_NAME,
  DEFAULT_GROUP_PATH,
  DEFAULT_GROUP_NAME,
  type GroupedItem
} from "./groups"
import type { Session, Group } from "@/core/types"

function createMockSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "test-id",
    title: "Test Session",
    projectPath: "/test/path",
    groupPath: DEFAULT_GROUP_PATH,
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

function createMockGroup(overrides: Partial<Group> = {}): Group {
  return {
    path: "test-group",
    name: "Test Group",
    expanded: true,
    order: 0,
    defaultPath: "",
    ...overrides,
  }
}

describe("ensureDefaultGroup", () => {
  test("adds default group when missing", () => {
    const groups: Group[] = []
    const result = ensureDefaultGroup(groups)

    expect(result).toHaveLength(1)
    expect(result[0]!.path).toBe(DEFAULT_GROUP_PATH)
    expect(result[0]!.name).toBe(DEFAULT_GROUP_NAME)
  })

  test("returns groups unchanged when default exists", () => {
    const groups = [createMockGroup({ path: DEFAULT_GROUP_PATH, name: DEFAULT_GROUP_NAME })]
    const result = ensureDefaultGroup(groups)

    expect(result).toHaveLength(1)
    expect(result[0]!.path).toBe(DEFAULT_GROUP_PATH)
  })

  test("preserves existing groups when adding default", () => {
    const groups = [createMockGroup({ path: "other", name: "Other", order: 0 })]
    const result = ensureDefaultGroup(groups)

    expect(result).toHaveLength(2)
    expect(result[0]!.path).toBe(DEFAULT_GROUP_PATH)
    expect(result[1]!.path).toBe("other")
  })
})

describe("flattenGroupTree", () => {
  test("returns empty array for empty inputs", () => {
    const result = flattenGroupTree([], [])
    expect(result).toEqual([])
  })

  test("creates group headers for each group", () => {
    const groups = [
      createMockGroup({ path: "group-1", order: 0 }),
      createMockGroup({ path: "group-2", order: 1 })
    ]
    const result = flattenGroupTree([], groups)

    expect(result).toHaveLength(2)
    expect(result[0]!.type).toBe("group")
    expect(result[1]!.type).toBe("group")
  })

  test("places sessions under their groups when expanded", () => {
    const groups = [createMockGroup({ path: "my-group", expanded: true })]
    const sessions = [
      createMockSession({ id: "s1", groupPath: "my-group" }),
      createMockSession({ id: "s2", groupPath: "my-group" })
    ]
    const result = flattenGroupTree(sessions, groups)

    expect(result).toHaveLength(3) // 1 group + 2 sessions
    expect(result[0]!.type).toBe("group")
    expect(result[1]!.type).toBe("session")
    expect(result[2]!.type).toBe("session")
  })

  test("hides sessions when group is collapsed", () => {
    const groups = [createMockGroup({ path: "my-group", expanded: false })]
    const sessions = [createMockSession({ id: "s1", groupPath: "my-group" })]
    const result = flattenGroupTree(sessions, groups)

    expect(result).toHaveLength(1) // Only group header
    expect(result[0]!.type).toBe("group")
  })

  test("assigns group indices 1-9 for hotkey jumps", () => {
    const groups = Array.from({ length: 10 }, (_, i) =>
      createMockGroup({ path: `group-${i}`, order: i })
    )
    const result = flattenGroupTree([], groups)

    expect(result[0]!.groupIndex).toBe(1)
    expect(result[8]!.groupIndex).toBe(9)
    expect(result[9]!.groupIndex).toBeUndefined()
  })
})

describe("prependCurrentGroup", () => {
  test("returns original grouped items when current sessions are empty", () => {
    const groups = [createMockGroup({ path: "group-1" })]
    const groupedItems = flattenGroupTree([], groups)

    const result = prependCurrentGroup(groupedItems, [])

    expect(result).toEqual(groupedItems)
  })

  test("adds virtual Current group before real groups", () => {
    const groups = [createMockGroup({ path: "group-1", name: "Group 1" })]
    const currentSession = createMockSession({ id: "current-1", groupPath: "group-1" })
    const groupedItems = flattenGroupTree([currentSession], groups)

    const result = prependCurrentGroup(groupedItems, [currentSession])

    expect(result[0]!.type).toBe("group")
    expect(result[0]!.groupPath).toBe(CURRENT_GROUP_PATH)
    expect(result[0]!.group?.name).toBe(CURRENT_GROUP_NAME)
    expect(result[0]!.isVirtual).toBe(true)
    expect(result[0]!.virtualType).toBe("current")
    expect(result[1]!.type).toBe("session")
    expect(result[1]!.session?.id).toBe("current-1")
    expect(result[1]!.isCurrent).toBe(true)
  })

  test("does not consume numeric group indexes for real groups", () => {
    const groups = [
      createMockGroup({ path: "group-1", order: 0 }),
      createMockGroup({ path: "group-2", order: 1 })
    ]
    const currentSession = createMockSession({ id: "current-1", groupPath: "group-1" })
    const groupedItems = flattenGroupTree([currentSession], groups)

    const result = prependCurrentGroup(groupedItems, [currentSession])
    const realGroups = result.filter(item => item.type === "group" && !item.isVirtual)

    expect(result[0]!.groupIndex).toBeUndefined()
    expect(realGroups[0]!.groupIndex).toBe(1)
    expect(realGroups[1]!.groupIndex).toBe(2)
  })

  test("renders only Current header when collapsed", () => {
    const groups = [createMockGroup({ path: "group-1" })]
    const currentSession = createMockSession({ id: "current-1", groupPath: "group-1" })
    const groupedItems = flattenGroupTree([currentSession], groups)

    const result = prependCurrentGroup(groupedItems, [currentSession], false)

    expect(result[0]!.type).toBe("group")
    expect(result[0]!.groupPath).toBe(CURRENT_GROUP_PATH)
    expect(result[1]!.type).toBe("group")
    expect(result.some(item => item.isCurrent)).toBe(false)
  })
})

describe("getGroupSessionCount", () => {
  test("returns 0 for empty sessions", () => {
    expect(getGroupSessionCount([], "any-group")).toBe(0)
  })

  test("counts sessions in the specified group", () => {
    const sessions = [
      createMockSession({ id: "1", groupPath: "group-a" }),
      createMockSession({ id: "2", groupPath: "group-a" }),
      createMockSession({ id: "3", groupPath: "group-b" })
    ]
    expect(getGroupSessionCount(sessions, "group-a")).toBe(2)
    expect(getGroupSessionCount(sessions, "group-b")).toBe(1)
  })
})

describe("getGroupStatusSummary", () => {
  test("counts sessions by status", () => {
    const sessions = [
      createMockSession({ id: "1", groupPath: "g", status: "running" }),
      createMockSession({ id: "2", groupPath: "g", status: "running" }),
      createMockSession({ id: "3", groupPath: "g", status: "waiting" })
    ]
    const summary = getGroupStatusSummary(sessions, "g")

    expect(summary.running).toBe(2)
    expect(summary.waiting).toBe(1)
  })
})

describe("generateGroupPath", () => {
  test("converts name to lowercase kebab-case", () => {
    expect(generateGroupPath("My Group", [])).toBe("my-group")
    expect(generateGroupPath("Backend Work", [])).toBe("backend-work")
  })

  test("removes special characters", () => {
    expect(generateGroupPath("Test @#$ Group!", [])).toBe("test-group")
  })

  test("appends number if path already exists", () => {
    const existing = ["my-group"]
    expect(generateGroupPath("My Group", existing)).toBe("my-group-1")
  })

  test("increments number until unique", () => {
    const existing = ["test", "test-1", "test-2"]
    expect(generateGroupPath("Test", existing)).toBe("test-3")
  })
})

// Helpers to build GroupedItem rows for selection tests.
function sessItem(id: string, groupPath: string): GroupedItem {
  return {
    type: "session",
    session: createMockSession({ id, groupPath }),
    groupPath,
    isLast: false,
  }
}
function curSessItem(id: string): GroupedItem {
  return {
    type: "session",
    session: createMockSession({ id }),
    groupPath: CURRENT_GROUP_PATH,
    isLast: false,
    isVirtual: true,
    virtualType: "current",
    isCurrent: true,
  }
}
function groupItem(path: string): GroupedItem {
  return { type: "group", group: createMockGroup({ path }), groupPath: path, isLast: false }
}
const tasksItem: GroupedItem = { type: "group", groupPath: "__tasks__", isLast: false, isVirtual: true, virtualType: "tasks" }
const currentHeaderItem: GroupedItem = { type: "group", groupPath: CURRENT_GROUP_PATH, isLast: false, isVirtual: true, virtualType: "current" }

describe("itemKey", () => {
  test("distinguishes a Current session copy from its real-group copy", () => {
    expect(itemKey(curSessItem("A"))).toBe("cur:A")
    expect(itemKey(sessItem("A", "g1"))).toBe("sess:g1:A")
  })

  test("keys virtual entries and group headers", () => {
    expect(itemKey(tasksItem)).toBe("virt:tasks")
    expect(itemKey(currentHeaderItem)).toBe("virt:current")
    expect(itemKey(groupItem("g1"))).toBe("group:g1")
  })

  test("returns null for a missing item", () => {
    expect(itemKey(undefined)).toBeNull()
  })
})

describe("resolveSelection", () => {
  test("follows the same session when a Current row above it drops out", () => {
    // Cursor on Current session B (index 3).
    const before = [tasksItem, currentHeaderItem, curSessItem("A"), curSessItem("B"), groupItem("g1"), sessItem("C", "g1")]
    const key = itemKey(before[3])
    expect(key).toBe("cur:B")

    // A leaves Current (status change) → everything below shifts up.
    const after = [tasksItem, currentHeaderItem, curSessItem("B"), groupItem("g1"), sessItem("C", "g1")]
    const res = resolveSelection(after, key, 3)
    expect(res.index).toBe(2) // follows B, not the group header now at index 3
    expect(res.key).toBe("cur:B")
  })

  test("does not jump between the Current and real-group copies of one session", () => {
    const items = [currentHeaderItem, curSessItem("X"), groupItem("g1"), sessItem("X", "g1")]
    expect(resolveSelection(items, "cur:X", 1).index).toBe(1)
    expect(resolveSelection(items, "sess:g1:X", 1).index).toBe(3)
  })

  test("clamps and re-keys when the selected item is gone", () => {
    const items = [tasksItem, currentHeaderItem, curSessItem("B")]
    const res = resolveSelection(items, "cur:GONE", 5)
    expect(res.index).toBe(2) // clamped to last
    expect(res.key).toBe("cur:B")
  })

  test("handles an empty list", () => {
    expect(resolveSelection([], "cur:B", 3)).toEqual({ index: 0, key: null })
  })
})
