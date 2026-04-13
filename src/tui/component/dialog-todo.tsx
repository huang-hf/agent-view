/**
 * TODO queue dialog for session view
 * Per-session prompt queue: send to tmux, pop to clipboard, add, or delete
 */

import { createSignal, For, Show } from "solid-js"
import { InputRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import { DialogHeader } from "@tui/ui/dialog-header"
import { DialogFooter } from "@tui/ui/dialog-footer"
import { listTodos, addTodo, removeTodo } from "@/core/todo"
import { copyToClipboard } from "@tui/util/clipboard"
import { getSessionManager } from "@/core/session"

interface DialogTodoProps {
  sessionId: string
}

export function DialogTodo(props: DialogTodoProps) {
  const dialog = useDialog()
  const toast = useToast()
  const { theme } = useTheme()
  const manager = getSessionManager()

  type Mode = "list" | "add"
  const [mode, setMode] = createSignal<Mode>("list")
  const [items, setItems] = createSignal(listTodos(props.sessionId))
  const [selectedIdx, setSelectedIdx] = createSignal(0)
  const [newText, setNewText] = createSignal("")

  let inputRef: InputRenderable | undefined

  function refresh() {
    const updated = listTodos(props.sessionId)
    setItems(updated)
    // Clamp selected index
    if (selectedIdx() >= updated.length && updated.length > 0) {
      setSelectedIdx(updated.length - 1)
    }
  }

  function enterAddMode() {
    setNewText("")
    setMode("add")
    setTimeout(() => inputRef?.focus(), 1)
  }

  async function handleAdd() {
    const text = newText().trim()
    if (!text) {
      setMode("list")
      return
    }
    addTodo(props.sessionId, text)
    refresh()
    setMode("list")
  }

  async function handleSend() {
    const item = items()[selectedIdx()]
    if (!item) return
    try {
      await manager.sendMessage(props.sessionId, item.text)
      removeTodo(props.sessionId, item.id)
      refresh()
      toast.show({ message: "Sent to session", variant: "success", duration: 1500 })
    } catch (err) {
      toast.error(err as Error)
    }
  }

  async function handlePop() {
    const item = items()[selectedIdx()]
    if (!item) return
    try {
      await copyToClipboard(item.text)
      removeTodo(props.sessionId, item.id)
      refresh()
      toast.show({ message: "Copied to clipboard", variant: "success", duration: 1500 })
    } catch (err) {
      toast.error(err as Error)
    }
  }

  function handleDelete() {
    const item = items()[selectedIdx()]
    if (!item) return
    removeTodo(props.sessionId, item.id)
    refresh()
  }

  useKeyboard((evt) => {
    if (mode() === "add") {
      if (evt.name === "return" && !evt.shift) {
        evt.preventDefault()
        handleAdd()
      }
      if (evt.name === "escape") {
        evt.preventDefault()
        setMode("list")
      }
      return
    }

    // list mode
    if (evt.name === "escape") {
      evt.preventDefault()
      dialog.clear()
      return
    }

    if (evt.name === "up" || evt.name === "k") {
      evt.preventDefault()
      setSelectedIdx((i) => Math.max(0, i - 1))
      return
    }

    if (evt.name === "down" || evt.name === "j") {
      evt.preventDefault()
      setSelectedIdx((i) => Math.min(items().length - 1, i + 1))
      return
    }

    if (evt.name === "return" && !evt.shift) {
      evt.preventDefault()
      handleSend()
      return
    }

    if (evt.name === "p") {
      evt.preventDefault()
      handlePop()
      return
    }

    if (evt.name === "a") {
      evt.preventDefault()
      enterAddMode()
      return
    }

    if (evt.name === "d") {
      evt.preventDefault()
      handleDelete()
      return
    }
  })

  return (
    <box gap={1} paddingBottom={1}>
      <DialogHeader title="TODO Queue" />

      <Show when={mode() === "list"}>
        <Show
          when={items().length > 0}
          fallback={
            <box paddingLeft={4} paddingRight={4} paddingTop={1}>
              <text fg={theme.textMuted}>No items. Press `a` to add.</text>
            </box>
          }
        >
          <box paddingLeft={4} paddingRight={4} paddingTop={1} flexDirection="column" gap={0}>
            <For each={items()}>
              {(item, idx) => (
                <box
                  flexDirection="row"
                  gap={1}
                  height={1}
                  paddingLeft={1}
                  backgroundColor={idx() === selectedIdx() ? theme.backgroundElement : undefined}
                  onMouseUp={() => setSelectedIdx(idx())}
                >
                  <text fg={idx() === selectedIdx() ? theme.primary : theme.textMuted}>
                    {idx() === selectedIdx() ? "▶" : " "}
                  </text>
                  <text fg={idx() === selectedIdx() ? theme.text : theme.textMuted} wrapMode="none">
                    {item.text}
                  </text>
                </box>
              )}
            </For>
          </box>
        </Show>

        <DialogFooter hint="Enter: send | p: clipboard | a: add | d: delete | Esc: close" />
      </Show>

      <Show when={mode() === "add"}>
        <box paddingLeft={4} paddingRight={4} paddingTop={1} gap={1}>
          <text fg={theme.primary}>New item</text>
          <input
            placeholder="Enter text to queue..."
            value={newText()}
            onInput={setNewText}
            focusedBackgroundColor={theme.backgroundElement}
            cursorColor={theme.primary}
            focusedTextColor={theme.text}
            ref={(r) => {
              inputRef = r
            }}
          />
        </box>

        <DialogFooter hint="Enter: add | Esc: cancel" />
      </Show>
    </box>
  )
}
