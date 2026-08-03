/**
 * Group utility functions for organizing sessions
 */

import type { Session, Group } from "@/core/types"

export interface GroupedItem {
  type: "group" | "session"
  group?: Group
  session?: Session
  groupPath: string
  isLast: boolean
  groupIndex?: number  // 1-9 for hotkey jumps
  isVirtual?: boolean
  virtualType?: "current" | "tasks"
  isCurrent?: boolean
}

export const DEFAULT_GROUP_PATH = "my-sessions"
export const DEFAULT_GROUP_NAME = "My Sessions"
export const CURRENT_GROUP_PATH = "__current__"
export const CURRENT_GROUP_NAME = "Current"
export const TASKS_ENTRY_PATH = "__tasks__"
export const TASKS_ENTRY_NAME = "Tasks"

export function ensureDefaultGroup(groups: Group[]): Group[] {
  const hasDefault = groups.some(g => g.path === DEFAULT_GROUP_PATH)
  if (hasDefault) return groups

  const defaultGroup: Group = {
    path: DEFAULT_GROUP_PATH,
    name: DEFAULT_GROUP_NAME,
    expanded: true,
    order: 0,
    defaultPath: ""
  }

  // Insert at beginning and adjust orders
  return [defaultGroup, ...groups.map(g => ({ ...g, order: g.order + 1 }))]
}

/**
 * Flatten groups and sessions into a navigable list
 * Returns an array where each item is either a group header or a session
 */
export function flattenGroupTree(sessions: Session[], groups: Group[]): GroupedItem[] {
  const result: GroupedItem[] = []

  // Sort groups by order
  const sortedGroups = [...groups].sort((a, b) => a.order - b.order)

  // Create a map of groupPath -> sessions
  const sessionsByGroup = new Map<string, Session[]>()
  for (const session of sessions) {
    const groupPath = session.groupPath || DEFAULT_GROUP_PATH
    const existing = sessionsByGroup.get(groupPath) || []
    existing.push(session)
    sessionsByGroup.set(groupPath, existing)
  }

  // Sort sessions within each group by creation time
  for (const [path, groupSessions] of sessionsByGroup) {
    sessionsByGroup.set(path, groupSessions.sort((a, b) =>
      b.createdAt.getTime() - a.createdAt.getTime()
    ))
  }

  // Build flattened list
  let groupIndex = 1
  for (const group of sortedGroups) {
    const groupSessions = sessionsByGroup.get(group.path) || []

    // Add group header
    result.push({
      type: "group",
      group,
      groupPath: group.path,
      isLast: false,
      groupIndex: groupIndex <= 9 ? groupIndex : undefined
    })
    groupIndex++

    // If expanded, add sessions
    if (group.expanded) {
      for (let i = 0; i < groupSessions.length; i++) {
        result.push({
          type: "session",
          session: groupSessions[i],
          groupPath: group.path,
          isLast: i === groupSessions.length - 1
        })
      }
    }
  }

  // Handle orphan sessions (in groups that don't exist)
  const knownGroupPaths = new Set(sortedGroups.map(g => g.path))
  for (const [path, groupSessions] of sessionsByGroup) {
    if (!knownGroupPaths.has(path)) {
      // Create implicit group for orphans
      result.push({
        type: "group",
        group: {
          path,
          name: path,
          expanded: true,
          order: 999,
          defaultPath: ""
        },
        groupPath: path,
        isLast: false,
        groupIndex: groupIndex <= 9 ? groupIndex : undefined
      })
      groupIndex++

      for (let i = 0; i < groupSessions.length; i++) {
        result.push({
          type: "session",
          session: groupSessions[i],
          groupPath: path,
          isLast: i === groupSessions.length - 1
        })
      }
    }
  }

  return result
}

export function prependCurrentGroup(
  groupedItems: GroupedItem[],
  currentSessions: Session[],
  expanded = true
): GroupedItem[] {
  if (currentSessions.length === 0) return groupedItems

  const currentGroup: Group = {
    path: CURRENT_GROUP_PATH,
    name: CURRENT_GROUP_NAME,
    expanded,
    order: -1,
    defaultPath: ""
  }

  const currentItems: GroupedItem[] = [
    {
      type: "group",
      group: currentGroup,
      groupPath: CURRENT_GROUP_PATH,
      isLast: false,
      isVirtual: true,
      virtualType: "current"
    }
  ]

  if (expanded) {
    for (let i = 0; i < currentSessions.length; i++) {
      currentItems.push({
        type: "session",
        session: currentSessions[i],
        groupPath: CURRENT_GROUP_PATH,
        isLast: i === currentSessions.length - 1,
        isVirtual: true,
        virtualType: "current",
        isCurrent: true
      })
    }
  }

  return [...currentItems, ...groupedItems]
}

export function prependTasksEntry(groupedItems: GroupedItem[]): GroupedItem[] {
  const tasksGroup: Group = {
    path: TASKS_ENTRY_PATH,
    name: TASKS_ENTRY_NAME,
    expanded: false,
    order: -2,
    defaultPath: ""
  }
  const entry: GroupedItem = {
    type: "group",
    group: tasksGroup,
    groupPath: TASKS_ENTRY_PATH,
    isLast: false,
    isVirtual: true,
    virtualType: "tasks"
  }
  return [entry, ...groupedItems]
}

export function getGroupSessionCount(sessions: Session[], groupPath: string): number {
  return sessions.filter(s => (s.groupPath || DEFAULT_GROUP_PATH) === groupPath).length
}

export function getGroupStatusSummary(sessions: Session[], groupPath: string): {
  running: number
  waiting: number
} {
  const groupSessions = sessions.filter(s => (s.groupPath || DEFAULT_GROUP_PATH) === groupPath)
  return {
    running: groupSessions.filter(s => s.status === "running").length,
    waiting: groupSessions.filter(s => s.status === "waiting").length
  }
}

export function generateGroupPath(name: string, existingPaths: string[]): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  let path = base || "group"
  let counter = 1

  while (existingPaths.includes(path)) {
    path = `${base}-${counter}`
    counter++
  }

  return path
}
