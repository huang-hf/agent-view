# Task Board & Team Mode Design

## Overview

Two related features:

1. **Task Board** — a dedicated screen for recording and managing text todo items
2. **Team Mode** — sending tasks to existing sessions (roles), plus a CLI for agents to create/manage tasks

These are intentionally lightweight. Tasks are plain text. No project binding, no priorities, no assignee metadata beyond "which session did I send this to."

---

## Data Model

### `Task` type (`src/core/types.ts`)

```ts
export interface Task {
  id: string
  text: string    // full task content, single field
  done: boolean
  createdAt: Date
  order: number
}
```

### SQLite table (`src/core/storage.ts`)

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
)
```

Schema version bumped from 2 → 3. Migration adds the `tasks` table; existing installations upgrade automatically on first run.

### Storage methods added to `Storage` class

- `loadTasks(): Task[]`
- `saveTask(task: Task): void`
- `deleteTask(id: string): void`
- `updateTaskField(id: string, field: string, value: unknown): void`

Pattern is identical to existing session CRUD.

---

## UI: Task Board Screen

### Navigation

- Press `t` on the home screen to enter the task board
- Press `q` or `Escape` to return to home

### Layout

```
┌─────────────────────────────────────────┐
│  Tasks                        [2/5 done] │
├─────────────────────────────────────────┤
│ ► [ ] power model 上线 qwen3-235b        │
│   [x] 更新 gradio inference 服务版本     │
│   [ ] 排查 arena session 超时问题         │
│   [ ] 写 weekly report                   │
│                                          │
├─────────────────────────────────────────┤
│ n:新建  space:完成  s:发送  e:编辑  d:删除  q:返回 │
└─────────────────────────────────────────┘
```

Header shows `[done/total]` count. Done tasks render with `[x]` and dimmed text. Cursor is highlighted with `►`.

### Keybinds

| Key | Action |
|---|---|
| `↑` / `↓` | Move cursor |
| `n` | New task — opens text input at bottom |
| `space` | Toggle done/undone |
| `e` | Edit task text — opens text input pre-filled |
| `d` | Delete task (no confirmation) |
| `s` | Send to session |
| `q` / `Escape` | Return to home |

### New/Edit Input

Reuses the dialog-rename pattern: a single-line text input rendered at the bottom of the screen. `Enter` confirms, `Escape` cancels. For new tasks, a `nanoid`-generated id and current timestamp are assigned on save.

### Send to Session (`s` key)

Opens a `DialogSelect` listing all sessions with status `running`, `waiting`, or `idle`. Selecting a session calls `sendKeys(session.tmuxSession, task.text)`. A toast confirms "Sent to [session title]". The task is not automatically marked done.

---

## CLI: `av task` Subcommand

Agents running inside tmux sessions can manage tasks via shell commands. All operations write to the same SQLite database.

```bash
av task add "power model 上线 qwen3-235b"   # create task, prints new id
av task list                                  # list all tasks with ids and status
av task done <id>                             # mark task done
av task edit <id> "new text"                  # replace task text
```

Output of `av task list`:

```
ID        DONE  TEXT
a1b2c3    [ ]   power model 上线 qwen3-235b
d4e5f6    [x]   更新 gradio inference 服务版本
```

### Implementation

New subcommand handler in `src/cli/` (e.g. `src/cli/task.ts`), wired into the main CLI entry point. Uses the same `Storage` class as the TUI.

---

## Files Changed

| File | Change |
|---|---|
| `src/core/types.ts` | Add `Task` interface |
| `src/core/storage.ts` | Add `tasks` table, CRUD methods, schema v3 migration |
| `src/tui/routes/tasks.tsx` | New task board screen |
| `src/tui/component/dialog-task-input.tsx` | New/edit task text input |
| `src/tui/routes/home.tsx` | Register `t` keybind to navigate to tasks |
| `src/tui/routes/index.ts` | Register tasks route |
| `src/cli/task.ts` | `av task` subcommand |
| `src/cli/index.ts` | Wire in task subcommand |

---

## Out of Scope

- Task priorities or tags
- Per-project task lists (tasks are global)
- Tracking which session a task was sent to
- Automatic task completion when a session finishes
- Task ordering via drag (keyboard reorder can be added later if needed)
