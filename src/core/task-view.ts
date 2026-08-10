/**
 * Shared derivations for the task board — the single source of truth for how
 * tasks are split into columns and grouped, so the interactive Tasks screen and
 * the read-only home preview stay in lock-step (row indices must match).
 */

import type { Task } from "./types"
import { dayLabel } from "./day-label"

/** 待办: active tasks in their manual sort order (loadTasks is already sorted). */
export function activeTasks(all: Task[]): Task[] {
  return all.filter(t => !t.done)
}

/** 已完成: done tasks, most-recently-completed first. */
export function doneTasks(all: Task[]): Task[] {
  return all
    .filter(t => t.done)
    .sort((a, b) => {
      const ta = a.completedAt?.getTime() ?? a.createdAt.getTime()
      const tb = b.completedAt?.getTime() ?? b.createdAt.getTime()
      return tb - ta
    })
}

export interface DoneGroup {
  label: string
  /** Each item keeps its flat index into the doneTasks() list. */
  items: { task: Task; idx: number }[]
}

/**
 * Group the (already newest-first) done tasks into contiguous day buckets.
 * `done` must be the output of doneTasks() so idx aligns with selection.
 */
export function groupDoneByDay(done: Task[], now: Date): DoneGroup[] {
  const groups: DoneGroup[] = []
  done.forEach((task, idx) => {
    const label = dayLabel(task.completedAt ?? task.createdAt, now)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push({ task, idx })
    else groups.push({ label, items: [{ task, idx }] })
  })
  return groups
}
