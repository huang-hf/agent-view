/**
 * Task board screen — two columns: 待办 (active) | 已完成 (done, newest first).
 * j/k: move within column, h/l or ←/→: switch column, ↑/↓: reorder (待办 only),
 * Enter/e: edit (vim), n: new, space: toggle done, d: delete, s: send to session, q: back
 */

import { createSignal, createMemo, For, Show } from "solid-js"
import { useKeyboard, useTerminalDimensions, useRenderer } from "@opentui/solid"
import { useRoute } from "@tui/context/route"
import { useTheme } from "@tui/context/theme"
import { useSync } from "@tui/context/sync"
import { useToast } from "@tui/ui/toast"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { getStorage } from "@/core/storage"
import { openTaskEditor } from "@/core/task-editor"
import { getSessionManager } from "@/core/session"
import { dayLabel } from "@/core/day-label"
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
  const renderer = useRenderer()
  const storage = getStorage()

  // Run the external editor with the TUI suspended so vim owns the terminal.
  async function runEditor(id: string, text: string): Promise<string | null> {
    renderer.suspend()
    try {
      return await openTaskEditor(id, text)
    } finally {
      renderer.resume()
    }
  }

  const [tasks, setTasks] = createSignal<Task[]>(storage.loadTasks())
  // column: 0 = 待办 (active), 1 = 已完成 (done). row: index within that column.
  const [column, setColumn] = createSignal(0)
  const [row, setRow] = createSignal(0)

  function reload() {
    setTasks(storage.loadTasks())
  }

  // 待办: active tasks in their manual sort order (loadTasks is already sorted).
  const activeTasks = createMemo(() => tasks().filter(t => !t.done))
  // 已完成: done tasks, most-recently-completed first.
  const doneTasks = createMemo(() =>
    tasks()
      .filter(t => t.done)
      .sort((a, b) => {
        const ta = a.completedAt?.getTime() ?? a.createdAt.getTime()
        const tb = b.completedAt?.getTime() ?? b.createdAt.getTime()
        return tb - ta
      })
  )
  const doneCount = createMemo(() => doneTasks().length)

  // Group the (already newest-first) done tasks into contiguous day buckets.
  // Each item keeps its flat index into doneTasks() so selection still tracks
  // "the Nth done task" regardless of the injected date headers.
  const doneGroups = createMemo(() => {
    const now = new Date()
    const groups: { label: string; items: { task: Task; idx: number }[] }[] = []
    doneTasks().forEach((task, idx) => {
      const label = dayLabel(task.completedAt ?? task.createdAt, now)
      const last = groups[groups.length - 1]
      if (last && last.label === label) last.items.push({ task, idx })
      else groups.push({ label, items: [{ task, idx }] })
    })
    return groups
  })

  const currentList = createMemo(() => (column() === 0 ? activeTasks() : doneTasks()))
  const selectedTask = createMemo<Task | undefined>(() => currentList()[row()])

  function clampRow(col: number, idx: number) {
    const len = (col === 0 ? activeTasks() : doneTasks()).length
    if (len === 0) return 0
    return Math.max(0, Math.min(idx, len - 1))
  }

  function focusColumn(col: number) {
    setColumn(col)
    setRow(r => clampRow(col, r))
  }

  async function editTask(task: Task) {
    try {
      const result = await runEditor(task.id, task.text)
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
      const result = await runEditor(id, "")
      if (result !== null) {
        const all = tasks()
        const maxOrder = all.reduce((m, t) => Math.max(m, t.order), -1)
        const task: Task = {
          id,
          text: result,
          done: false,
          createdAt: new Date(),
          order: maxOrder + 1,
          completedAt: null,
        }
        storage.saveTask(task)
        reload()
        // Focus the newly-added task at the tail of 待办.
        setColumn(0)
        setRow(activeTasks().length - 1)
      }
    } catch (err) {
      toast.error(err as Error)
    }
  }

  function toggleDone() {
    const task = selectedTask()
    if (!task) return
    storage.setTaskDone(task.id, !task.done)
    reload()
    // The task jumped columns; keep the cursor in the current column, clamped.
    setRow(r => clampRow(column(), r))
  }

  function deleteTask() {
    const task = selectedTask()
    if (!task) return
    storage.deleteTask(task.id)
    reload()
    setRow(r => clampRow(column(), r))
  }

  // Reorder within 待办 only (已完成 is ordered by completion time).
  function reorderActive(dir: -1 | 1) {
    if (column() !== 0) return
    const idx = row()
    const list = activeTasks()
    const j = idx + dir
    if (j < 0 || j >= list.length) return
    const a = list[idx]
    const b = list[j]
    storage.updateTaskField(a.id, "sort_order", b.order)
    storage.updateTaskField(b.id, "sort_order", a.order)
    reload()
    setRow(j)
  }

  function sendToSession() {
    const task = selectedTask()
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
            // Send the text WITHOUT Enter so it sits in the input box, then
            // attach straight into the session (suspend TUI while attached).
            await getSessionManager().sendMessage(session.id, task.text, { enter: false })
            renderer.suspend()
            try {
              await getSessionManager().attach(session.id)
            } finally {
              renderer.resume()
            }
          } catch (err) {
            toast.error(err as Error)
          }
        }}
      />
    ))
  }

  function stop(evt: { stopPropagation(): void; preventDefault(): void }) {
    evt.stopPropagation()
    evt.preventDefault()
  }

  // Column geometry: content area minus a 3-cell separator ("  │"), split evenly.
  const colWidth = createMemo(() => {
    const inner = dimensions().width - 2 // content paddingLeft/Right
    return Math.max(6, Math.floor((inner - 3) / 2))
  })
  // Width available for the task text, after the marker + checkbox prefix.
  const textWidth = createMemo(() => Math.max(1, colWidth() - 7))

  // First line only, truncated with an ellipsis so long tasks never wrap.
  function fit(text: string): string {
    const line = text.split("\n")[0]
    const max = textWidth()
    return line.length > max ? line.slice(0, Math.max(0, max - 1)) + "…" : line
  }

  useKeyboard((evt) => {
    if (dialog.stack.length > 0) return

    if (evt.name === "j") {
      setRow(r => clampRow(column(), r + 1))
      return stop(evt)
    }
    if (evt.name === "k") {
      setRow(r => clampRow(column(), r - 1))
      return stop(evt)
    }
    if (evt.name === "h" || evt.name === "left") {
      focusColumn(0)
      return stop(evt)
    }
    if (evt.name === "l" || evt.name === "right") {
      focusColumn(1)
      return stop(evt)
    }
    if (evt.name === "up") {
      reorderActive(-1)
      return stop(evt)
    }
    if (evt.name === "down") {
      reorderActive(1)
      return stop(evt)
    }
    if (evt.name === "return" || evt.name === "e") {
      const task = selectedTask()
      if (task) editTask(task)
      return stop(evt)
    }
    if (evt.name === "n") {
      newTask()
      return stop(evt)
    }
    if (evt.name === "space") {
      toggleDone()
      return stop(evt)
    }
    if (evt.name === "d") {
      deleteTask()
      return stop(evt)
    }
    if (evt.name === "s") {
      sendToSession()
      return stop(evt)
    }
    if (evt.name === "?") {
      dialog.push(() => (
        <DialogSelect
          title="任务看板快捷键"
          options={[
            { title: "j / k        — 列内上下移动光标", value: "" },
            { title: "h / l  ← / → — 切换 待办 / 已完成 列", value: "" },
            { title: "↑ / ↓       — 调整待办排序", value: "" },
            { title: "n           — 新建任务（vim 编辑）", value: "" },
            { title: "Enter / e   — 编辑当前任务", value: "" },
            { title: "Space       — 切换完成状态（在两列间移动）", value: "" },
            { title: "s           — 发送给 session 并进入", value: "" },
            { title: "d           — 删除任务", value: "" },
            { title: "q / Escape  — 返回主屏", value: "" },
          ]}
          onSelect={() => dialog.pop()}
        />
      ))
      return stop(evt)
    }
    if (evt.name === "q" || evt.name === "escape") {
      if (route.canGoBack()) {
        route.back()
      } else {
        route.navigate({ type: "home" })
      }
      return stop(evt)
    }
  })

  return (
    <box
      flexDirection="column"
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor={theme.background}
    >
      {/* Header */}
      <box
        flexDirection="row"
        justifyContent="space-between"
        paddingLeft={2}
        paddingRight={2}
        height={1}
        backgroundColor={theme.backgroundPanel}
      >
        <text fg={theme.primary} bold>
          TASKS
        </text>
        <text fg={theme.textMuted}>
          {`${doneCount()}/${tasks().length} 完成`}
        </text>
      </box>

      {/* Two-column board: 待办 | 已完成 */}
      <box flexDirection="row" flexGrow={1} paddingLeft={1} paddingRight={1} paddingTop={1}>
        {/* 待办 column */}
        <box flexDirection="column" width={colWidth()} flexShrink={0}>
          <text fg={column() === 0 ? theme.primary : theme.textMuted} bold>
            {`待办 (${activeTasks().length})`}
          </text>
          <Show
            when={activeTasks().length > 0}
            fallback={<text fg={theme.textMuted}>{"  （空）"}</text>}
          >
            <For each={activeTasks()}>
              {(task, i) => {
                const isSelected = () => column() === 0 && i() === row()
                return (
                  <text fg={isSelected() ? theme.primary : theme.text} bold={isSelected()}>
                    {`${isSelected() ? "►" : " "} [ ] ${fit(task.text)}`}
                  </text>
                )
              }}
            </For>
          </Show>
        </box>

        {/* Separator */}
        <box width={3} flexShrink={0} alignItems="center">
          <text fg={theme.border}>{"│"}</text>
        </box>

        {/* 已完成 column — grouped by completion day */}
        <box flexDirection="column" flexGrow={1}>
          <text fg={column() === 1 ? theme.primary : theme.textMuted} bold>
            {`已完成 (${doneTasks().length})`}
          </text>
          <Show
            when={doneTasks().length > 0}
            fallback={<text fg={theme.textMuted}>{"  （空）"}</text>}
          >
            <For each={doneGroups()}>
              {(group) => (
                <box flexDirection="column">
                  {/* Date header — not selectable */}
                  <text fg={theme.textMuted} bold>{` ${group.label}`}</text>
                  <For each={group.items}>
                    {(item) => {
                      const isSelected = () => column() === 1 && item.idx === row()
                      return (
                        <text fg={isSelected() ? theme.primary : theme.textMuted} bold={isSelected()} dim>
                          {`${isSelected() ? " ►" : "  "} [x] ${fit(item.task.text)}`}
                        </text>
                      )
                    }}
                  </For>
                </box>
              )}
            </For>
          </Show>
        </box>
      </box>

      {/* Footer with keybinds */}
      <box
        flexDirection="column"
        width={dimensions().width}
        paddingLeft={2}
        paddingRight={2}
        height={2}
        backgroundColor={theme.backgroundPanel}
      >
        <text fg={theme.textMuted}>
          {"j/k:移动  h/l:切换列  ↑/↓:排序  n:新建  Enter/e:编辑"}
        </text>
        <text fg={theme.textMuted}>
          {"space:完成  s:发送并进入  d:删除  q:返回  ?:帮助"}
        </text>
      </box>
    </box>
  )
}
