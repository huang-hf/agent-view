/**
 * Per-session TODO queue manager
 * Stores items in SQLite metadata table with key `todo_queue:<sessionId>`
 */

import { getStorage } from "@/core/storage"

export interface TodoItem {
  id: string
  text: string
  createdAt: number
}

function storageKey(sessionId: string): string {
  return `todo_queue:${sessionId}`
}

export function listTodos(sessionId: string): TodoItem[] {
  const storage = getStorage()
  const raw = storage.getMeta(storageKey(sessionId))
  if (!raw) return []
  try {
    return JSON.parse(raw) as TodoItem[]
  } catch {
    return []
  }
}

function saveTodos(sessionId: string, items: TodoItem[]): void {
  const storage = getStorage()
  storage.setMeta(storageKey(sessionId), JSON.stringify(items))
}

export function addTodo(sessionId: string, text: string): TodoItem {
  const item: TodoItem = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    text: text.trim(),
    createdAt: Date.now(),
  }
  const items = listTodos(sessionId)
  items.push(item)
  saveTodos(sessionId, items)
  return item
}

export function removeTodo(sessionId: string, id: string): void {
  const items = listTodos(sessionId).filter((item) => item.id !== id)
  saveTodos(sessionId, items)
}
