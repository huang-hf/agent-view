/**
 * Task board screen
 * j/k: navigate, ↑/↓: reorder, Enter/e: edit (vim popup), n: new, space: toggle done, d: delete, s: send to session, q/Escape: back
 */

import { createSignal, createMemo, For } from "solid-js"
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

  function stop(evt: { stopPropagation(): void; preventDefault(): void }) {
    evt.stopPropagation()
    evt.preventDefault()
  }

  useKeyboard((evt) => {
    if (dialog.stack.length > 0) return

    if (evt.name === "j") {
      setSelectedIndex(i => clampIndex(i + 1))
      return stop(evt)
    }
    if (evt.name === "k") {
      setSelectedIndex(i => clampIndex(i - 1))
      return stop(evt)
    }
    if (evt.name === "up") {
      moveUp()
      return stop(evt)
    }
    if (evt.name === "down") {
      moveDown()
      return stop(evt)
    }
    if (evt.name === "return" || evt.name === "e") {
      const task = tasks()[selectedIndex()]
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
            { title: "j / k        — 上下移动光标", value: "" },
            { title: "↑ / ↓       — 调整任务排序", value: "" },
            { title: "n           — 新建任务（vim 编辑）", value: "" },
            { title: "Enter / e   — 编辑当前任务", value: "" },
            { title: "Space       — 切换完成状态", value: "" },
            { title: "s           — 发送给 session", value: "" },
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
      <text x={0} y={h() - 3}>
        {"─".repeat(w())}
      </text>
      <text x={1} y={h() - 2}>
        {"j/k:移动  ↑/↓:排序  n:新建  Enter/e:编辑  space:完成/未完成"}
      </text>
      <text x={1} y={h() - 1}>
        {"s:发送给session  d:删除  q:返回主屏  ?:帮助"}
      </text>
    </box>
  )
}
