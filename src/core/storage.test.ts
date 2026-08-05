import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Storage } from "./storage"
import type { Task } from "./types"

describe("Task CRUD", () => {
  let storage: Storage

  beforeEach(() => {
    storage = new Storage({ dbPath: ":memory:" })
    storage.migrate()
  })

  afterEach(() => {
    storage.close()
  })

  test("saveTask and loadTasks round-trip", () => {
    const task: Task = {
      id: "t1",
      text: "power model 上线",
      done: false,
      createdAt: new Date(1000000),
      order: 0,
      completedAt: null,
    }
    storage.saveTask(task)
    const tasks = storage.loadTasks()
    expect(tasks).toHaveLength(1)
    expect(tasks[0].id).toBe("t1")
    expect(tasks[0].text).toBe("power model 上线")
    expect(tasks[0].done).toBe(false)
    expect(tasks[0].order).toBe(0)
    expect(tasks[0].completedAt).toBeNull()
  })

  test("updateTaskField done", () => {
    const task: Task = { id: "t2", text: "test", done: false, createdAt: new Date(1000000), order: 0, completedAt: null }
    storage.saveTask(task)
    storage.updateTaskField("t2", "done", 1)
    const tasks = storage.loadTasks()
    expect(tasks[0].done).toBe(true)
  })

  test("setTaskDone stamps and clears completedAt", () => {
    const task: Task = { id: "d1", text: "x", done: false, createdAt: new Date(1000000), order: 0, completedAt: null }
    storage.saveTask(task)
    storage.setTaskDone("d1", true)
    let t = storage.loadTasks()[0]
    expect(t.done).toBe(true)
    expect(t.completedAt).toBeInstanceOf(Date)
    storage.setTaskDone("d1", false)
    t = storage.loadTasks()[0]
    expect(t.done).toBe(false)
    expect(t.completedAt).toBeNull()
  })

  test("deleteTask removes the task", () => {
    const task: Task = { id: "t3", text: "delete me", done: false, createdAt: new Date(1000000), order: 0, completedAt: null }
    storage.saveTask(task)
    storage.deleteTask("t3")
    expect(storage.loadTasks()).toHaveLength(0)
  })

  test("loadTasks returns ordered by sort_order", () => {
    storage.saveTask({ id: "b", text: "B", done: false, createdAt: new Date(1000000), order: 1, completedAt: null })
    storage.saveTask({ id: "a", text: "A", done: false, createdAt: new Date(1000000), order: 0, completedAt: null })
    const tasks = storage.loadTasks()
    expect(tasks[0].id).toBe("a")
    expect(tasks[1].id).toBe("b")
  })
})
