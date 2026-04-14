/**
 * Simple input dialog component
 * Used for collecting single text values
 */

import { createSignal } from "solid-js"
import { InputRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { DialogHeader } from "@tui/ui/dialog-header"
import { DialogFooter } from "@tui/ui/dialog-footer"
import { ActionButton } from "@tui/ui/action-button"

export interface DialogInputProps {
  title: string
  placeholder?: string
  initialValue?: string
  onSubmit: (value: string) => void
}

export function DialogInput(props: DialogInputProps) {
  const dialog = useDialog()
  const { theme } = useTheme()

  const [value, setValue] = createSignal(props.initialValue || "")
  const [submitting, setSubmitting] = createSignal(false)

  let inputRef: InputRenderable | undefined

  function handleSubmit() {
    if (submitting()) return
    setSubmitting(true)
    props.onSubmit(value())
  }

  useKeyboard((evt) => {
    if (evt.name === "return" && !evt.shift) {
      evt.preventDefault()
      handleSubmit()
    }
  })

  return (
    <box gap={1} paddingBottom={1}>
      <DialogHeader title={props.title} />

      <box paddingLeft={4} paddingRight={4} paddingTop={1} gap={1}>
        <input
          value={value()}
          onInput={setValue}
          placeholder={props.placeholder}
          focusedBackgroundColor={theme.backgroundElement}
          cursorColor={theme.primary}
          focusedTextColor={theme.text}
          ref={(r) => {
            inputRef = r
            setTimeout(() => inputRef?.focus(), 1)
          }}
        />
      </box>

      <ActionButton
        label="Submit"
        loadingLabel="..."
        loading={submitting()}
        onAction={handleSubmit}
      />

      <DialogFooter hint="Enter: submit | Esc: cancel" />
    </box>
  )
}
