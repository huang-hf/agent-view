/**
 * Edit session dialog — title + free-text note (e.g. "what am I waiting on").
 */

import { createSignal } from "solid-js"
import { InputRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useSync } from "@tui/context/sync"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import { DialogHeader } from "@tui/ui/dialog-header"
import { DialogFooter } from "@tui/ui/dialog-footer"
import { ActionButton } from "@tui/ui/action-button"
import type { Session } from "@/core/types"

interface DialogEditSessionProps {
  session: Session
}

export function DialogEditSession(props: DialogEditSessionProps) {
  const dialog = useDialog()
  const sync = useSync()
  const toast = useToast()
  const { theme } = useTheme()

  const [title, setTitle] = createSignal(props.session.title)
  const [note, setNote] = createSignal(props.session.note ?? "")
  const [focused, setFocused] = createSignal<"title" | "note">("title")
  const [saving, setSaving] = createSignal(false)

  let titleRef: InputRenderable | undefined
  let noteRef: InputRenderable | undefined

  async function handleSave() {
    if (saving()) return

    const newTitle = title().trim()
    if (!newTitle) {
      toast.show({ message: "Title cannot be empty", variant: "error", duration: 2000 })
      return
    }

    const newNote = note().trim()
    const titleChanged = newTitle !== props.session.title
    const noteChanged = newNote !== (props.session.note ?? "")

    if (!titleChanged && !noteChanged) {
      dialog.clear()
      return
    }

    setSaving(true)
    try {
      if (titleChanged) await sync.session.rename(props.session.id, newTitle)
      if (noteChanged) sync.session.setNote(props.session.id, newNote)
      toast.show({ message: "Saved", variant: "success", duration: 1500 })
      dialog.clear()
      sync.refresh()
    } catch (err) {
      toast.error(err as Error)
    } finally {
      setSaving(false)
    }
  }

  function focus(which: "title" | "note") {
    setFocused(which)
    ;(which === "title" ? titleRef : noteRef)?.focus()
  }

  useKeyboard((evt) => {
    if (evt.name === "tab") {
      evt.preventDefault()
      focus(focused() === "title" ? "note" : "title")
      return
    }
    if (evt.name === "return" && !evt.shift) {
      evt.preventDefault()
      handleSave()
    }
  })

  return (
    <box gap={1} paddingBottom={1}>
      <DialogHeader title="Edit Session" />

      {/* Title field */}
      <box paddingLeft={4} paddingRight={4} paddingTop={1} gap={1}>
        <text fg={focused() === "title" ? theme.primary : theme.textMuted}>Title</text>
        <input
          value={title()}
          onInput={setTitle}
          focusedBackgroundColor={theme.backgroundElement}
          cursorColor={theme.primary}
          focusedTextColor={theme.text}
          onMouseDown={() => setFocused("title")}
          ref={(r) => {
            titleRef = r
            setTimeout(() => titleRef?.focus(), 1)
          }}
        />
      </box>

      {/* Note field */}
      <box paddingLeft={4} paddingRight={4} gap={1}>
        <text fg={focused() === "note" ? theme.primary : theme.textMuted}>Note — what are you waiting on?</text>
        <input
          value={note()}
          onInput={setNote}
          placeholder="e.g. waiting on colleague for the 3090 box"
          focusedBackgroundColor={theme.backgroundElement}
          cursorColor={theme.primary}
          focusedTextColor={theme.text}
          onMouseDown={() => setFocused("note")}
          ref={(r) => { noteRef = r }}
        />
      </box>

      <ActionButton
        label="Save"
        loadingLabel="Saving..."
        loading={saving()}
        onAction={handleSave}
      />

      <DialogFooter hint="Tab: switch field | Enter: save | Esc: cancel" />
    </box>
  )
}
