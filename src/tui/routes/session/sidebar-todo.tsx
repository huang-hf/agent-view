/**
 * Persistent TODO sidebar for session view
 * Always visible on the right; mouse-driven interactions
 */

import { createSignal, For, Show } from "solid-js"
import { InputRenderable, TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { useToast } from "@tui/ui/toast"
import { listTodos, addTodo, removeTodo, type TodoItem } from "@/core/todo"
import { copyToClipboard } from "@tui/util/clipboard"

export const SIDEBAR_WIDTH = 28

interface TodoSidebarProps {
  sessionId: string
  onSend: (text: string) => Promise<void>
}

export function TodoSidebar(props: TodoSidebarProps) {
  const { theme } = useTheme()
  const toast = useToast()

  const [items, setItems] = createSignal<TodoItem[]>(listTodos(props.sessionId))
  const [addText, setAddText] = createSignal("")
  const [adding, setAdding] = createSignal(false)

  let inputRef: InputRenderable | undefined

  function refresh() {
    setItems(listTodos(props.sessionId))
  }

  async function handleSend(item: TodoItem) {
    try {
      await props.onSend(item.text)
      removeTodo(props.sessionId, item.id)
      refresh()
    } catch (err) {
      toast.error(err as Error)
    }
  }

  async function handleCopy(item: TodoItem) {
    try {
      await copyToClipboard(item.text)
      removeTodo(props.sessionId, item.id)
      refresh()
      toast.show({ message: "Copied", variant: "success", duration: 1200 })
    } catch (err) {
      toast.error(err as Error)
    }
  }

  function handleDelete(item: TodoItem) {
    removeTodo(props.sessionId, item.id)
    refresh()
  }

  async function handleAdd() {
    const text = addText().trim()
    if (text) {
      addTodo(props.sessionId, text)
      setAddText("")
      refresh()
    }
    setAdding(false)
  }

  function startAdding() {
    setAdding(true)
    setTimeout(() => inputRef?.focus(), 1)
  }

  const textWidth = SIDEBAR_WIDTH - 6 // room for action buttons

  function truncate(text: string, max: number): string {
    return text.length > max ? text.slice(0, max - 1) + "…" : text
  }

  return (
    <box
      width={SIDEBAR_WIDTH}
      flexDirection="column"
      backgroundColor={theme.backgroundPanel}
    >
      {/* Header */}
      <box
        height={1}
        paddingLeft={1}
        paddingRight={1}
        flexDirection="row"
        justifyContent="space-between"
        backgroundColor={theme.backgroundElement}
      >
        <text fg={theme.primary} attributes={TextAttributes.BOLD}>TODO</text>
        <text fg={theme.textMuted}>{items().length > 0 ? `${items().length}` : ""}</text>
      </box>

      {/* Item list */}
      <box flexGrow={1} flexDirection="column" paddingTop={1}>
        <Show
          when={items().length > 0}
          fallback={
            <box paddingLeft={1}>
              <text fg={theme.textMuted}>empty</text>
            </box>
          }
        >
          <For each={items()}>
            {(item) => (
              <box flexDirection="column" marginBottom={1}>
                {/* Item text */}
                <box paddingLeft={1} paddingRight={1}>
                  <text fg={theme.text} wrapMode="word">
                    {truncate(item.text, textWidth)}
                  </text>
                </box>
                {/* Action buttons */}
                <box flexDirection="row" paddingLeft={1} gap={1}>
                  <box
                    onMouseUp={() => handleSend(item)}
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={theme.backgroundElement}
                  >
                    <text fg={theme.success}>→</text>
                  </box>
                  <box
                    onMouseUp={() => handleCopy(item)}
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={theme.backgroundElement}
                  >
                    <text fg={theme.primary}>✂</text>
                  </box>
                  <box
                    onMouseUp={() => handleDelete(item)}
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={theme.backgroundElement}
                  >
                    <text fg={theme.textMuted}>x</text>
                  </box>
                </box>
              </box>
            )}
          </For>
        </Show>
      </box>

      {/* Add area */}
      <box flexDirection="column" paddingLeft={1} paddingRight={1} paddingBottom={1}>
        <Show
          when={adding()}
          fallback={
            <box
              onMouseUp={startAdding}
              backgroundColor={theme.backgroundElement}
              paddingLeft={1}
              paddingRight={1}
            >
              <text fg={theme.textMuted}>+ add item</text>
            </box>
          }
        >
          <input
            value={addText()}
            onInput={setAddText}
            onReturn={handleAdd}
            placeholder="new item..."
            focusedBackgroundColor={theme.backgroundElement}
            cursorColor={theme.primary}
            focusedTextColor={theme.text}
            ref={(r) => { inputRef = r }}
          />
        </Show>
      </box>
    </box>
  )
}
