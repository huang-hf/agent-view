/**
 * TaskBoardView — the visual body of the task board (two columns + detail
 * panel), rendered from plain props so it can be reused by both the interactive
 * Tasks screen and the read-only home preview.
 *
 * It renders no chrome (no header/footer) and owns no state or keyboard — the
 * caller supplies tasks + the current selection (column/row) and the width to
 * lay out within. Meant to sit inside a flexDirection="column" container.
 */

import { createMemo, createEffect, For, Show } from "solid-js"
import { ScrollBoxRenderable } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { activeTasks, doneTasks, groupDoneByDay } from "@/core/task-view"
import type { Task } from "@/core/types"

export interface TaskBoardViewProps {
  tasks: Task[]
  /** 0 = 待办 (active), 1 = 已完成 (done). */
  column: number
  /** Selected index within the focused column. */
  row: number
  /** Total width available to lay the board out in. */
  width: number
}

const DETAIL_LINES = 5

export function TaskBoardView(props: TaskBoardViewProps) {
  const { theme } = useTheme()

  const active = createMemo(() => activeTasks(props.tasks))
  const done = createMemo(() => doneTasks(props.tasks))
  const groups = createMemo(() => groupDoneByDay(done(), new Date()))
  const selected = createMemo<Task | undefined>(() =>
    (props.column === 0 ? active() : done())[props.row]
  )

  // Column geometry: content area minus a 3-cell separator, split evenly.
  const colWidth = createMemo(() => Math.max(6, Math.floor((props.width - 2 - 3) / 2)))
  // Text budget after the marker + checkbox prefix.
  const textWidth = createMemo(() => Math.max(1, colWidth() - 7))
  const detailWidth = createMemo(() => Math.max(1, props.width - 2))

  // First line only, truncated with an ellipsis so long tasks never wrap.
  function fit(text: string): string {
    const line = text.split("\n")[0]
    const max = textWidth()
    return line.length > max ? line.slice(0, Math.max(0, max - 1)) + "…" : line
  }

  function wrapText(text: string, width: number, maxLines: number): string[] {
    const w = Math.max(1, width)
    const lines: string[] = []
    for (const para of text.split("\n")) {
      if (para === "") { lines.push(""); continue }
      for (let i = 0; i < para.length; i += w) lines.push(para.slice(i, i + w))
    }
    if (lines.length <= maxLines) return lines
    const clipped = lines.slice(0, maxLines)
    const last = clipped[maxLines - 1]
    clipped[maxLines - 1] = last.length >= w ? last.slice(0, w - 1) + "…" : last + "…"
    return clipped
  }

  const detailLines = createMemo(() => {
    const t = selected()
    if (!t) return []
    return wrapText(t.text, detailWidth(), DETAIL_LINES)
  })

  // Scrollable columns: long lists overflow into a scrollbox instead of being
  // flex-shrunk into overlapping rows. Keep the selected row in view.
  let activeScrollRef: ScrollBoxRenderable | undefined
  let doneScrollRef: ScrollBoxRenderable | undefined

  // Row offset of the selected done item, counting the day headers between groups.
  function doneRowOffset(): number {
    let y = 0
    for (const g of groups()) {
      y += 1 // date header
      for (const it of g.items) {
        if (it.idx === props.row) return y
        y += 1
      }
    }
    return y
  }

  function scrollIntoView(ref: ScrollBoxRenderable | undefined, targetY: number) {
    if (!ref) return
    const vh = ref.viewport?.height ?? 0
    if (vh <= 0) return
    const top = ref.scrollTop
    if (targetY < top) ref.scrollTo(targetY)
    else if (targetY >= top + vh) ref.scrollTo(targetY - vh + 1)
  }

  createEffect(() => {
    const col = props.column
    const r = props.row
    if (col === 0) {
      active() // reactive dep
      scrollIntoView(activeScrollRef, r)
    } else {
      groups() // reactive dep
      scrollIntoView(doneScrollRef, doneRowOffset())
    }
  })

  return (
    <>
      {/* Two-column board: 待办 | 已完成 */}
      <box flexDirection="row" flexGrow={1} paddingLeft={1} paddingRight={1} paddingTop={1}>
        {/* 待办 column */}
        <box flexDirection="column" width={colWidth()} flexShrink={0}>
          <text fg={props.column === 0 ? theme.primary : theme.textMuted} bold>
            {`待办 (${active().length})`}
          </text>
          <Show
            when={active().length > 0}
            fallback={<text fg={theme.textMuted}>{"  （空）"}</text>}
          >
            <scrollbox flexGrow={1} scrollbarOptions={{ visible: true }} ref={(r: ScrollBoxRenderable) => { activeScrollRef = r }}>
              <For each={active()}>
                {(task, i) => {
                  const isSelected = () => props.column === 0 && i() === props.row
                  return (
                    <text fg={isSelected() ? theme.primary : theme.text} bold={isSelected()}>
                      {`${isSelected() ? "►" : " "} [ ] ${fit(task.text)}`}
                    </text>
                  )
                }}
              </For>
            </scrollbox>
          </Show>
        </box>

        {/* Separator */}
        <box width={3} flexShrink={0} alignItems="center">
          <text fg={theme.border}>{"│"}</text>
        </box>

        {/* 已完成 column — grouped by completion day */}
        <box flexDirection="column" flexGrow={1}>
          <text fg={props.column === 1 ? theme.primary : theme.textMuted} bold>
            {`已完成 (${done().length})`}
          </text>
          <Show
            when={done().length > 0}
            fallback={<text fg={theme.textMuted}>{"  （空）"}</text>}
          >
            <scrollbox flexGrow={1} scrollbarOptions={{ visible: true }} ref={(r: ScrollBoxRenderable) => { doneScrollRef = r }}>
              <For each={groups()}>
                {(group) => (
                  <box flexDirection="column" flexShrink={0}>
                    {/* Date header — not selectable */}
                    <text fg={theme.textMuted} bold>{` ${group.label}`}</text>
                    <For each={group.items}>
                      {(item) => {
                        const isSelected = () => props.column === 1 && item.idx === props.row
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
            </scrollbox>
          </Show>
        </box>
      </box>

      {/* Detail panel: full text of the selected task */}
      <box flexDirection="column" height={DETAIL_LINES + 1} paddingLeft={1} paddingRight={1} flexShrink={0}>
        <text fg={theme.border}>{"─".repeat(Math.max(0, props.width - 2))}</text>
        <Show
          when={selected()}
          fallback={<text fg={theme.textMuted}>{"（没有选中任务）"}</text>}
        >
          <For each={detailLines()}>
            {(line) => <text fg={theme.text}>{line || " "}</text>}
          </For>
        </Show>
      </box>
    </>
  )
}
