/**
 * av task subcommand — manage tasks from the CLI
 */

import { getStorage } from "../core/storage"
import type { Task } from "../core/types"

function generateId(): string {
  return Math.random().toString(36).slice(2, 8)
}

export async function cmdTaskAdd(text: string): Promise<void> {
  const storage = getStorage()
  const existing = storage.loadTasks()
  const maxOrder = existing.reduce((m, t) => Math.max(m, t.order), -1)
  const task: Task = {
    id: generateId(),
    text,
    done: false,
    createdAt: new Date(),
    order: maxOrder + 1,
  }
  storage.saveTask(task)
  console.log(task.id)
}

export async function cmdTaskList(): Promise<void> {
  const storage = getStorage()
  const tasks = storage.loadTasks()
  if (tasks.length === 0) {
    console.log("No tasks.")
    return
  }
  const idWidth = Math.max(8, ...tasks.map(t => t.id.length))
  console.log(`${"ID".padEnd(idWidth)}  状态  内容`)
  for (const t of tasks) {
    const status = t.done ? "[x]" : "[ ]"
    console.log(`${t.id.padEnd(idWidth)}  ${status}   ${t.text}`)
  }
}

export async function cmdTaskDone(id: string): Promise<void> {
  const storage = getStorage()
  storage.updateTaskField(id, "done", 1)
  console.log(`Task ${id} marked done.`)
}

export async function cmdTaskEdit(id: string, text: string): Promise<void> {
  const storage = getStorage()
  storage.updateTaskField(id, "text", text)
  console.log(`Task ${id} updated.`)
}
