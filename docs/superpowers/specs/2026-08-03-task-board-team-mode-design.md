# 任务看板与团队模式设计

## 概述

两个关联功能：

1. **任务看板** — 独立页面，用于记录和管理文本待办任务
2. **团队模式** — 将任务发送给已有的 session（角色），以及供 agent 使用的 CLI 命令

设计刻意保持轻量。任务就是纯文本，不绑定项目，没有优先级，没有除"发送给哪个 session"之外的元数据。

---

## 数据模型

### `Task` 类型（`src/core/types.ts`）

```ts
export interface Task {
  id: string
  text: string    // 任务内容，单字段纯文本
  done: boolean
  createdAt: Date
  order: number
}
```

### SQLite 表（`src/core/storage.ts`）

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
)
```

schema version 从 2 升到 3，首次运行时自动迁移，已有数据不受影响。

### Storage 类新增方法

- `loadTasks(): Task[]`
- `saveTask(task: Task): void`
- `deleteTask(id: string): void`
- `updateTaskField(id: string, field: string, value: unknown): void`

模式与现有 session CRUD 完全一致。

---

## UI：任务看板页面

### 导航

- 主屏按 `t` 进入任务看板
- 按 `q` 或 `Escape` 返回主屏

### 布局

```
┌─────────────────────────────────────────┐
│  Tasks                        [2/5 完成] │
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

标题栏显示 `[已完成/总数]`。已完成任务显示 `[x]` 并用暗色渲染。当前光标位置用 `►` 标记。

### 键位

| 键 | 动作 |
|---|---|
| `j` / `k` | 在任务之间切换 |
| `↑` / `↓` | 将当前任务上移/下移（调整排序） |
| `Enter` / `e` | 打开 vim 编辑任务内容 |
| `n` | 新建任务并立即打开 vim 编辑 |
| `space` | 切换完成/未完成 |
| `d` | 删除任务（无需确认） |
| `s` | 发送给 session |
| `q` / `Escape` | 返回主屏 |

### 新建/编辑（vim popup）

任务内容为多行文本，通过 `tmux display-popup` 在浮层中打开 vim 编辑，复用现有 scratchpad 机制：

1. 将任务文本写入临时文件（`/tmp/av-task-<id>.txt`）
2. 执行 `tmux -L agent-view display-popup -w 80% -h 80% -E "vim /tmp/av-task-<id>.txt"`
3. 用户在 vim 里编辑，`:wq` 保存退出，popup 自动关闭
4. 读回文件内容，更新 SQLite，删除临时文件

新建任务时：先生成 id 和时间戳，临时文件内容为空，vim 退出后若文件非空则保存，为空则放弃。TUI 在 popup 下继续运行，无需暂停/恢复渲染。

### 发送给 Session（`s` 键）

弹出 `DialogSelect`，列出所有状态为 `running`、`waiting` 或 `idle` 的 session。选中后调用 `sendKeys(session.tmuxSession, task.text)`，toast 提示"已发送给 [session 标题]"。任务不会自动标记为完成。

---

## CLI：`av task` 子命令

在 tmux session 里跑的 agent 可以通过 shell 命令管理任务，所有操作写入同一个 SQLite 数据库。

```bash
av task add "power model 上线 qwen3-235b"   # 创建任务，输出新 id
av task list                                  # 列出所有任务（含 id 和状态）
av task done <id>                             # 标记完成
av task edit <id> "新的内容"                  # 修改任务文本
```

`av task list` 输出格式：

```
ID        状态  内容
a1b2c3    [ ]   power model 上线 qwen3-235b
d4e5f6    [x]   更新 gradio inference 服务版本
```

### 实现位置

在 `src/cli/` 下新增 `src/cli/task.ts` 子命令处理器，接入主 CLI 入口。使用与 TUI 相同的 `Storage` 类。

---

## 涉及文件

| 文件 | 变更 |
|---|---|
| `src/core/types.ts` | 新增 `Task` interface |
| `src/core/storage.ts` | 新增 `tasks` 表、CRUD 方法、schema v3 迁移 |
| `src/tui/routes/tasks.tsx` | 新建任务看板页面 |
| `src/core/task-editor.ts` | vim popup 编辑任务的工具函数 |
| `src/tui/routes/home.tsx` | 注册 `t` 键跳转任务看板 |
| `src/tui/routes/index.ts` | 注册 tasks 路由 |
| `src/cli/task.ts` | `av task` 子命令 |
| `src/cli/index.ts` | 接入 task 子命令 |

---

## 不在范围内

- 任务优先级或标签
- 按项目区分的任务列表（任务是全局的）
- 记录任务发给了哪个 session
- session 完成后自动标记任务为完成
- 拖拽排序（键盘排序已通过 `↑`/`↓` 支持）
