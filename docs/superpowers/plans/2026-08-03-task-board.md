# Task Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增任务看板功能——一个独立的 TUI 页面用于管理纯文本待办任务，支持 vim 编辑、发送给 session，以及供 agent 使用的 `av task` CLI 子命令。

**Architecture:** 任务持久化在已有 SQLite（schema v3 新增 `tasks` 表），TUI 新增 `tasks` 路由页面，编辑通过 `tmux display-popup` 打开 vim（复用 scratchpad 机制），CLI 子命令复用同一 `Storage` 类。

**Tech Stack:** Bun, Solid.js, OpenTUI, bun:sqlite, tmux display-popup

## Global Constraints

- 运行时：Bun（不用 Node.js API，用 `import ... from "bun:sqlite"`）
- 构建：每次代码改动后必须 `bun run build` 验证
- 导入：每个文件独立管理 import，不自动导入
- 测试：`bun test`
- 路径别名：`@/` = `src/`，`@tui/` = `src/tui/`

---

### Task 1: 数据模型 — `Task` 类型 + SQLite CRUD

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/storage.ts`
- Test: `src/core/storage.test.ts`（已有文件，追加测试）

**Interfaces:**
- Produces:
  - `Task` interface（id: string, text: string, done: boolean, createdAt: Date, order: number）
  - `Storage.loadTasks(): Task[]`
  - `Storage.saveTask(task: Task): void`
  - `Storage.deleteTask(id: string): void`
  - `Storage.updateTaskField(id: string, field: "text" | "done" | "sort_order", value: unknown): void`

- [ ] **Step 1: 在 types.ts 末尾追加 Task interface**

在 `src/core/types.ts` 末尾添加：

```ts
export interface Task {
  id: string
  text: string
  done: boolean
  createdAt: Date
  order: number
}
```

- [ ] **Step 2: 在 storage.ts 的 migrate() 中添加 tasks 表**

在 `Storage.migrate()` 方法里，`heartbeats` 表创建之后追加：

```ts
this.db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  )
`)
```

同时将 `SCHEMA_VERSION` 常量从 `2` 改为 `3`，并在 migration 区块追加：

```ts
// No-op migration for v3: tasks table created via CREATE TABLE IF NOT EXISTS above
```

- [ ] **Step 3: 在 Storage 类末尾添加 Task CRUD 方法**

在 `src/core/storage.ts` 的 `Storage` 类末尾（`resignPrimary` 方法之后，`setMeta` 之前）添加：

```ts
// Task CRUD

loadTasks(): Task[] {
  if (this.closed) return []
  const stmt = this.db.prepare(
    "SELECT id, text, done, created_at, sort_order FROM tasks ORDER BY sort_order, created_at"
  )
  const rows = stmt.all() as any[]
  return rows.map(row => ({
    id: row.id,
    text: row.text,
    done: row.done === 1,
    createdAt: new Date(row.created_at),
    order: row.sort_order,
  }))
}

saveTask(task: Task): void {
  if (this.closed) return
  const stmt = this.db.prepare(`
    INSERT OR REPLACE INTO tasks (id, text, done, created_at, sort_order)
    VALUES (?, ?, ?, ?, ?)
  `)
  stmt.run(task.id, task.text, task.done ? 1 : 0, task.createdAt.getTime(), task.order)
}

deleteTask(id: string): void {
  const stmt = this.db.prepare("DELETE FROM tasks WHERE id = ?")
  stmt.run(id)
}

updateTaskField(id: string, field: "text" | "done" | "sort_order", value: unknown): void {
  const stmt = this.db.prepare(`UPDATE tasks SET ${field} = ? WHERE id = ?`)
  stmt.run(value as string | number, id)
}
```

也需要在文件顶部 import 中引入 Task 类型（已有 `import type { Session, Group, StatusUpdate, Tool, SessionStatus } from "./types"` 那行，追加 `Task`）：

```ts
import type { Session, Group, StatusUpdate, Tool, SessionStatus, Task } from "./types"
```

- [ ] **Step 4: 写测试**

在 `src/core/storage.test.ts` 末尾追加：

```ts
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
    }
    storage.saveTask(task)
    const tasks = storage.loadTasks()
    expect(tasks).toHaveLength(1)
    expect(tasks[0].id).toBe("t1")
    expect(tasks[0].text).toBe("power model 上线")
    expect(tasks[0].done).toBe(false)
    expect(tasks[0].order).toBe(0)
  })

  test("updateTaskField done", () => {
    const task: Task = { id: "t2", text: "test", done: false, createdAt: new Date(1000000), order: 0 }
    storage.saveTask(task)
    storage.updateTaskField("t2", "done", 1)
    const tasks = storage.loadTasks()
    expect(tasks[0].done).toBe(true)
  })

  test("deleteTask removes the task", () => {
    const task: Task = { id: "t3", text: "delete me", done: false, createdAt: new Date(1000000), order: 0 }
    storage.saveTask(task)
    storage.deleteTask("t3")
    expect(storage.loadTasks()).toHaveLength(0)
  })

  test("loadTasks returns ordered by sort_order", () => {
    storage.saveTask({ id: "b", text: "B", done: false, createdAt: new Date(1000000), order: 1 })
    storage.saveTask({ id: "a", text: "A", done: false, createdAt: new Date(1000000), order: 0 })
    const tasks = storage.loadTasks()
    expect(tasks[0].id).toBe("a")
    expect(tasks[1].id).toBe("b")
  })
})
```

需要在测试文件顶部确认已引入 `Task`（如果没有，追加 import）：

```ts
import type { Task } from "./types"
```

- [ ] **Step 5: 运行测试确认通过**

```bash
bun test src/core/storage.test.ts
```

Expected: 所有 Task CRUD 测试 PASS

- [ ] **Step 6: 构建验证**

```bash
bun run build
```

Expected: 构建成功，无 TS 错误

- [ ] **Step 7: Commit**

```bash
git add src/core/types.ts src/core/storage.ts src/core/storage.test.ts
git commit -m "feat: add Task type and SQLite CRUD (schema v3)"
```

---

### Task 2: CLI — `av task` 子命令

**Files:**
- Create: `src/cli/task.ts`
- Modify: `src/cli/args.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `Storage.loadTasks()`, `Storage.saveTask()`, `Storage.deleteTask()`, `Storage.updateTaskField()`, `Task` from Task 1
- Produces: `av task add <text>`, `av task list`, `av task done <id>`, `av task edit <id> <text>` 四个子命令

- [ ] **Step 1: 创建 src/cli/task.ts**

```ts
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
```

- [ ] **Step 2: 在 args.ts 的 CLICommand 联合类型中追加 task 命令类型**

在 `src/cli/args.ts` 的 `CLICommand` 类型末尾（`auto-hibernate` 行之后）追加：

```ts
| { type: "task-add"; text: string }
| { type: "task-list" }
| { type: "task-done"; id: string }
| { type: "task-edit"; id: string; text: string }
```

- [ ] **Step 3: 在 args.ts 的 parseArgs 函数中解析 task 子命令**

在 `parseArgs` 函数内，找到处理其他子命令的区块，在 `return { type: "tui", mode }` 之前添加（或在 `args[0] === "task"` 时处理）：

```ts
if (args[0] === "task") {
  const sub = args[1]
  if (sub === "add") {
    const text = args.slice(2).join(" ")
    if (!text) {
      console.error("Usage: av task add <text>")
      process.exit(1)
    }
    return { type: "task-add", text }
  }
  if (sub === "list") {
    return { type: "task-list" }
  }
  if (sub === "done") {
    const id = args[2]
    if (!id) {
      console.error("Usage: av task done <id>")
      process.exit(1)
    }
    return { type: "task-done", id }
  }
  if (sub === "edit") {
    const id = args[2]
    const text = args.slice(3).join(" ")
    if (!id || !text) {
      console.error("Usage: av task edit <id> <text>")
      process.exit(1)
    }
    return { type: "task-edit", id, text }
  }
  console.error("Unknown task subcommand. Usage: av task [add|list|done|edit]")
  process.exit(1)
}
```

> 注意：这段代码要放在 `parseArgs` 内部，在默认返回 tui 之前。查看现有 `parseArgs` 的结构，在同级别的 `if (args[0] === "new")` 等判断旁边加入即可。

- [ ] **Step 4: 在 src/index.ts 的 executeHeadlessCommand 中分发 task 命令**

在 `executeHeadlessCommand` 的 switch 语句中（`case "auto-hibernate":` 之后）追加：

```ts
case "task-add":
  const { cmdTaskAdd } = await import("./cli/task")
  await cmdTaskAdd(command.text)
  break
case "task-list":
  const { cmdTaskList } = await import("./cli/task")
  await cmdTaskList()
  break
case "task-done":
  const { cmdTaskDone } = await import("./cli/task")
  await cmdTaskDone(command.id)
  break
case "task-edit":
  const { cmdTaskEdit } = await import("./cli/task")
  await cmdTaskEdit(command.id, command.text)
  break
```

> 注意：TypeScript 的 switch case 里不能重复声明 const，需要用块级作用域包裹或统一在 switch 外 import。改为在 switch 外先 import 所有 task 函数更简洁。将 `import("./cli/task")` 提到 `executeHeadlessCommand` 顶部的 lazy import 行，添加：

```ts
const { cmdTaskAdd, cmdTaskList, cmdTaskDone, cmdTaskEdit } = await import("./cli/task")
```

放在函数开头的解构行（与 `cmdNew, cmdList...` 同一行），然后 switch 里直接调用。

- [ ] **Step 5: 构建验证**

```bash
bun run build
```

Expected: 构建成功，无 TS 错误

- [ ] **Step 6: 手动测试 CLI**

```bash
# 编译后测试（dev 模式也可以）
bun run src/index.ts task add "power model 上线 qwen3-235b"
# 应该输出一个短 id，如 "a1b2c3"

bun run src/index.ts task list
# 应该显示刚创建的任务

bun run src/index.ts task done <上面输出的id>
bun run src/index.ts task list
# 状态应变为 [x]

bun run src/index.ts task edit <id> "修改后的内容"
bun run src/index.ts task list
# 内容应已更新
```

- [ ] **Step 7: Commit**

```bash
git add src/cli/task.ts src/cli/args.ts src/index.ts
git commit -m "feat: add av task CLI subcommand (add/list/done/edit)"
```

---

### Task 3: vim popup 编辑器工具函数

**Files:**
- Create: `src/core/task-editor.ts`

**Interfaces:**
- Consumes: `resolveScratchpadEditor` from `./scratchpad`，`TMUX_SOCKET` 常量（需要从 tmux.ts export 或在此处硬编码 `"agent-view"`）
- Produces:
  - `openTaskEditor(taskId: string, initialText: string): Promise<string | null>` — 返回编辑后的内容，用户未保存（空文件或 Escape 退出）返回 null

- [ ] **Step 1: 确认 TMUX_SOCKET 是否已 export**

```bash
grep -n "TMUX_SOCKET\|export.*TMUX" src/core/tmux.ts | head -5
```

如果 `TMUX_SOCKET` 是 `const TMUX_SOCKET = "agent-view"`（未 export），在 task-editor.ts 中直接硬编码字符串 `"agent-view"`，不需要改 tmux.ts。

- [ ] **Step 2: 创建 src/core/task-editor.ts**

```ts
/**
 * Opens a vim popup for editing task text via tmux display-popup.
 * Reuses the same mechanism as the scratchpad feature.
 */

import fs from "fs"
import os from "os"
import path from "path"
import { execFile } from "child_process"
import { promisify } from "util"
import { resolveScratchpadEditor } from "./scratchpad"

const execFileAsync = promisify(execFile)
const TMUX_SOCKET = "agent-view"

/**
 * Opens the user's editor ($EDITOR, vim, nano, vi) in a tmux display-popup
 * for editing the given text. Returns the saved content, or null if the user
 * quit without saving (file was empty or unchanged from empty).
 *
 * The caller is responsible for deciding what to do with null (discard new
 * task, keep old text for edits, etc.).
 */
export async function openTaskEditor(taskId: string, initialText: string): Promise<string | null> {
  const editor = resolveScratchpadEditor()
  if (!editor) {
    throw new Error("No editor found. Set $EDITOR or install vim.")
  }

  const tmpPath = path.join(os.tmpdir(), `av-task-${taskId}.txt`)

  try {
    fs.writeFileSync(tmpPath, initialText, { mode: 0o600 })

    await execFileAsync("tmux", [
      "-L", TMUX_SOCKET,
      "display-popup",
      "-w", "80%",
      "-h", "80%",
      "-E",
      `${editor} ${tmpPath}`,
    ])

    const content = fs.readFileSync(tmpPath, "utf-8")
    return content.trim() === "" ? null : content
  } finally {
    try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
  }
}
```

- [ ] **Step 3: 构建验证**

```bash
bun run build
```

Expected: 构建成功，无 TS 错误

- [ ] **Step 4: Commit**

```bash
git add src/core/task-editor.ts
git commit -m "feat: add openTaskEditor — vim popup via tmux display-popup"
```

---

### Task 4: 任务看板 TUI 页面

**Files:**
- Create: `src/tui/routes/tasks.tsx`
- Modify: `src/tui/context/route.tsx`
- Modify: `src/tui/app.tsx`
- Modify: `src/tui/routes/index.ts`
- Modify: `src/tui/routes/home.tsx`

**Interfaces:**
- Consumes:
  - `Task` from `@/core/types`
  - `getStorage` from `@/core/storage`
  - `openTaskEditor` from `@/core/task-editor`
  - `sendKeys` from `@/core/tmux`（已在 home.tsx 中 import，tasks.tsx 同样引入）
  - `useRoute` from `@tui/context/route`
  - `useKeyboard` from `@opentui/solid`
  - `useSync` from `@tui/context/sync`（获取 session 列表）
  - `useToast` from `@tui/ui/toast`
  - `useDialog` from `@tui/ui/dialog`
  - `DialogSelect` from `@tui/ui/dialog-select`
  - `useTheme` from `@tui/context/theme`
  - `useTerminalDimensions` from `@opentui/solid`

- [ ] **Step 1: 在 route.tsx 中添加 tasks 路由类型**

将 `RouteData` 类型改为：

```ts
export type RouteData =
  | { type: "home" }
  | { type: "session"; sessionId: string }
  | { type: "tasks" }
```

- [ ] **Step 2: 创建 src/tui/routes/tasks.tsx**

```tsx
/**
 * Task board screen
 * j/k: navigate, ↑/↓: reorder, Enter/e: edit (vim popup), n: new, space: toggle done, d: delete, s: send to session, q/Escape: back
 */

import { createSignal, createMemo, For, Show, onMount } from "solid-js"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { useRoute } from "@tui/context/route"
import { useTheme } from "@tui/context/theme"
import { useSync } from "@tui/context/sync"
import { useToast } from "@tui/ui/toast"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { getStorage } from "@/core/storage"
import { openTaskEditor } from "@/core/task-editor"
import { sendKeys } from "@/core/tmux"
import type { Task } from "@/core/types"

function generateId(): string {
  return Math.random().toString(36).slice(2, 8)
}

export function Tasks() {
  const route = useRoute()
  const { theme } = useTheme()
  const sync = useSync()
  const toast = useToast()
  const dialog = useDialog()
  const dimensions = useTerminalDimensions()
  const storage = getStorage()

  const [tasks, setTasks] = createSignal<Task[]>(storage.loadTasks())
  const [selectedIndex, setSelectedIndex] = createSignal(0)

  function reload() {
    setTasks(storage.loadTasks())
  }

  const doneCount = createMemo(() => tasks().filter(t => t.done).length)

  function clampIndex(idx: number) {
    const len = tasks().length
    if (len === 0) return 0
    return Math.max(0, Math.min(idx, len - 1))
  }

  async function editTask(task: Task) {
    try {
      const result = await openTaskEditor(task.id, task.text)
      if (result !== null) {
        storage.updateTaskField(task.id, "text", result)
        reload()
      }
    } catch (err) {
      toast.error(err as Error)
    }
  }

  async function newTask() {
    const id = generateId()
    try {
      const result = await openTaskEditor(id, "")
      if (result !== null) {
        const all = tasks()
        const maxOrder = all.reduce((m, t) => Math.max(m, t.order), -1)
        const task: Task = {
          id,
          text: result,
          done: false,
          createdAt: new Date(),
          order: maxOrder + 1,
        }
        storage.saveTask(task)
        reload()
        setSelectedIndex(tasks().length - 1)
      }
    } catch (err) {
      toast.error(err as Error)
    }
  }

  function toggleDone() {
    const task = tasks()[selectedIndex()]
    if (!task) return
    storage.updateTaskField(task.id, "done", task.done ? 0 : 1)
    reload()
  }

  function deleteTask() {
    const task = tasks()[selectedIndex()]
    if (!task) return
    storage.deleteTask(task.id)
    reload()
    setSelectedIndex(clampIndex(selectedIndex()))
  }

  function moveUp() {
    const idx = selectedIndex()
    if (idx === 0) return
    const all = tasks()
    const a = all[idx - 1]
    const b = all[idx]
    storage.updateTaskField(a.id, "sort_order", b.order)
    storage.updateTaskField(b.id, "sort_order", a.order)
    reload()
    setSelectedIndex(idx - 1)
  }

  function moveDown() {
    const idx = selectedIndex()
    const all = tasks()
    if (idx >= all.length - 1) return
    const a = all[idx]
    const b = all[idx + 1]
    storage.updateTaskField(a.id, "sort_order", b.order)
    storage.updateTaskField(b.id, "sort_order", a.order)
    reload()
    setSelectedIndex(idx + 1)
  }

  function sendToSession() {
    const task = tasks()[selectedIndex()]
    if (!task) return
    const sessions = sync.session.list().filter(
      s => s.status === "running" || s.status === "waiting" || s.status === "idle"
    )
    if (sessions.length === 0) {
      toast.show({ message: "没有可用的 session", variant: "error", duration: 2000 })
      return
    }
    dialog.push(() => (
      <DialogSelect
        title="发送给 Session"
        options={sessions.map(s => ({ title: s.title, value: s.id }))}
        onSelect={async (opt) => {
          dialog.pop()
          const session = sessions.find(s => s.id === opt.value)
          if (!session) return
          try {
            await sendKeys(session.tmuxSession, task.text)
            toast.show({ message: `已发送给 ${session.title}`, variant: "success", duration: 2000 })
          } catch (err) {
            toast.error(err as Error)
          }
        }}
      />
    ))
  }

  useKeyboard((evt) => {
    if (dialog.stack.length > 0) return

    if (evt.name === "j") {
      setSelectedIndex(i => clampIndex(i + 1))
      return
    }
    if (evt.name === "k") {
      setSelectedIndex(i => clampIndex(i - 1))
      return
    }
    if (evt.name === "up") {
      moveUp()
      return
    }
    if (evt.name === "down") {
      moveDown()
      return
    }
    if (evt.name === "return" || evt.name === "e") {
      const task = tasks()[selectedIndex()]
      if (task) editTask(task)
      return
    }
    if (evt.name === "n") {
      newTask()
      return
    }
    if (evt.name === "space") {
      toggleDone()
      return
    }
    if (evt.name === "d") {
      deleteTask()
      return
    }
    if (evt.name === "s") {
      sendToSession()
      return
    }
    if (evt.name === "q" || evt.name === "escape") {
      route.back()
      return
    }
  })

  const w = () => dimensions().width
  const h = () => dimensions().height

  return (
    <box width={w()} height={h()}>
      {/* Header */}
      <text x={1} y={0} bold>
        {`Tasks  [${doneCount()}/${tasks().length} 完成]`}
      </text>
      <text x={0} y={1}>
        {"─".repeat(w())}
      </text>

      {/* Task list */}
      <For each={tasks()}>
        {(task, i) => {
          const isSelected = () => i() === selectedIndex()
          const prefix = () => isSelected() ? "►" : " "
          const check = () => task.done ? "[x]" : "[ ]"
          const firstLine = () => task.text.split("\n")[0]
          return (
            <text
              x={1}
              y={i() + 2}
              bold={isSelected()}
              dim={task.done}
            >
              {`${prefix()} ${check()} ${firstLine()}`}
            </text>
          )
        }}
      </For>

      {/* Footer */}
      <text x={0} y={h() - 2}>
        {"─".repeat(w())}
      </text>
      <text x={1} y={h() - 1} dim>
        {"j/k:移动  ↑/↓:排序  n:新建  Enter:编辑  space:完成  s:发送  d:删除  q:返回"}
      </text>
    </box>
  )
}
```

- [ ] **Step 3: 在 src/tui/routes/index.ts 中 export Tasks**

追加一行：

```ts
export { Tasks } from "./tasks"
```

- [ ] **Step 4: 在 app.tsx 中添加 tasks 路由的 Match**

在 `src/tui/app.tsx` 中：

1. 在 import 区块追加：
```ts
import { Tasks } from "@tui/routes/tasks"
```

2. 在 `<Match when={route.data.type === "session"}>` 之后追加：
```tsx
<Match when={route.data.type === "tasks"}>
  <Tasks />
</Match>
```

- [ ] **Step 5: 在 home.tsx 中注册 t 键跳转 tasks**

home.tsx 目前没有 import `useRoute`，需要手动添加。

**5a. 在 home.tsx 的 import 区块追加（跟 `useTheme` / `useSync` 同一区域）：**

```ts
import { useRoute } from "@tui/context/route"
```

**5b. 在 `Home()` 组件内，`const keybind = useKeybind()` 之后追加：**

```ts
const route = useRoute()
```

**5c. 在 `useKeyboard` 回调中，`if (evt.name === "g" && !evt.shift)` 附近追加：**

```ts
if (evt.name === "t") {
  route.navigate({ type: "tasks" })
  return
}
```

- [ ] **Step 6: 构建验证**

```bash
bun run build
```

Expected: 构建成功，无 TS 错误

- [ ] **Step 7: 安装到本地并手动验证**

```bash
bun run install-local
av
```

手动测试流程：
1. 主屏按 `t` → 应进入任务看板（空列表）
2. 按 `n` → 应弹出 vim → 输入内容 → `:wq` 保存 → 应出现在列表
3. 按 `j`/`k` → 切换选中任务
4. 按 `Enter` → 应再次打开 vim 编辑
5. 按 `space` → 状态切换为 `[x]`
6. 按 `↑`/`↓` → 任务排序改变
7. 按 `s` → 弹出 session picker（如果有运行中的 session）
8. 按 `d` → 任务被删除
9. 按 `q` → 返回主屏

- [ ] **Step 8: Commit**

```bash
git add src/tui/routes/tasks.tsx src/tui/routes/index.ts src/tui/context/route.tsx src/tui/app.tsx src/tui/routes/home.tsx
git commit -m "feat: add task board TUI screen with vim editing and send-to-session"
```

---

## 完成检查

全部实现完成后确认：

- [ ] `bun test` 全部通过
- [ ] `bun run build` 无错误
- [ ] `av task add/list/done/edit` CLI 正常工作
- [ ] TUI 中 `t` 键进入任务看板
- [ ] 任务看板 j/k 导航、↑/↓ 排序、n 新建、Enter/e 编辑、space 完成、d 删除、s 发送、q 返回全部正常
- [ ] vim popup 在任务看板内正确弹出和关闭
