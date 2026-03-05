# Quick Confirm Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users confirm a waiting Claude session by pressing `y` in the home screen, without needing to attach into the tmux session.

**Architecture:** All changes are in `src/tui/routes/home.tsx`. Add a `previewScrollRef` to auto-scroll the right preview panel to the bottom on content update, add a `y` key handler that calls `sendKeys` to send Enter to the selected waiting session, and add visual hints in the preview header and footer.

**Tech Stack:** Solid.js, OpenTUI (`ScrollBoxRenderable.scrollTo`, `ScrollBoxRenderable.scrollHeight`), existing `sendKeys` from `src/core/tmux.ts`.

---

### Task 1: Auto-scroll preview to bottom

**Files:**
- Modify: `src/tui/routes/home.tsx`

**Context:**
The preview scrollbox (line ~940) currently has no ref. The left-panel scrollbox at line ~888 has `ref={(r: ScrollBoxRenderable) => { scrollRef = r }}` as an example of the pattern.
`ScrollBoxRenderable` is already imported at the top of the file (line 7).

**Step 1: Declare `previewScrollRef` variable**

After line 106 (`let scrollRef: ScrollBoxRenderable | undefined`), add:

```tsx
let previewScrollRef: ScrollBoxRenderable | undefined
```

**Step 2: Attach ref to preview scrollbox**

Find the preview scrollbox (around line 940):
```tsx
<scrollbox flexGrow={1} scrollbarOptions={{ visible: true }}>
```
Change it to:
```tsx
<scrollbox flexGrow={1} scrollbarOptions={{ visible: true }} ref={(r: ScrollBoxRenderable) => { previewScrollRef = r }}>
```

**Step 3: Scroll to bottom after content updates**

In the `createEffect` for preview (around line 193), after `setPreviewContent(content)`, add:
```tsx
setPreviewContent(content)
// Scroll to bottom after render
setTimeout(() => {
  if (previewScrollRef) {
    previewScrollRef.scrollTo(previewScrollRef.scrollHeight || 0)
  }
}, 0)
```

**Step 4: Also scroll to bottom when session changes**

In the same `createEffect`, at the point where `previewFetchAbort = false` is set (line ~181), reset scroll on session change:
```tsx
previewFetchAbort = false
// Reset scroll position for new session
setTimeout(() => {
  if (previewScrollRef) {
    previewScrollRef.scrollTo(previewScrollRef.scrollHeight || 0)
  }
}, 0)
```

**Step 5: Manual test**

```bash
bun run dev
```
- Create a Claude session and navigate to it
- Verify the right preview panel shows the bottom of the output (not the top)
- Navigate between sessions — each switch should show the bottom

**Step 6: Commit**

```bash
git add src/tui/routes/home.tsx
git commit -m "feat: auto-scroll preview panel to bottom on content update"
```

---

### Task 2: `y` key quick confirm

**Files:**
- Modify: `src/tui/routes/home.tsx`

**Context:**
`useKeyboard` handler starts at line ~417. The `sendKeys` function is already imported at line 26:
```tsx
import { attachSessionSync, capturePane, wasCommandPaletteRequested } from "@/core/tmux"
```
You need to add `sendKeys` to this import.

**Step 1: Add `sendKeys` to the tmux import**

Find (line ~26):
```tsx
import { attachSessionSync, capturePane, wasCommandPaletteRequested } from "@/core/tmux"
```
Change to:
```tsx
import { attachSessionSync, capturePane, wasCommandPaletteRequested, sendKeys } from "@/core/tmux"
```

**Step 2: Add `y` key handler in `useKeyboard`**

After the `z` key handler block (around line 562), add:

```tsx
// y to quick-confirm a waiting session (sends Enter without attaching)
if (evt.name === "y" && !evt.shift && !evt.ctrl) {
  const session = selectedSession()
  if (session && session.status === "waiting" && session.tmuxSession) {
    sendKeys(session.tmuxSession, "").then(() => {
      toast.show({ message: "✓ Confirmed", variant: "success", duration: 1500 })
      sync.refresh()
    }).catch((err) => {
      toast.error(err as Error)
    })
  }
  return
}
```

**Step 3: Manual test**

```bash
bun run dev
```
- Trigger a Claude permission prompt (e.g., start a session that needs tool approval)
- In Agent View, select the waiting session (status should show ◐)
- Press `y`
- Verify: toast "✓ Confirmed" appears, session status changes from waiting

**Step 4: Commit**

```bash
git add src/tui/routes/home.tsx
git commit -m "feat: add y key to confirm waiting sessions without attaching"
```

---

### Task 3: Visual hints — PreviewHeader

**Files:**
- Modify: `src/tui/routes/home.tsx`

**Context:**
`PreviewHeader` function is at line ~755. The status box currently looks like:
```tsx
<box flexDirection="row" gap={1}>
  <text fg={statusColor()}>{STATUS_ICONS[s().status]}</text>
  <text fg={statusColor()}>{s().status}</text>
</box>
```

**Step 1: Add `[y] confirm` hint next to status when waiting**

Replace the status box in `PreviewHeader`:
```tsx
<box flexDirection="row" gap={1}>
  <text fg={statusColor()}>{STATUS_ICONS[s().status]}</text>
  <text fg={statusColor()}>{s().status}</text>
  <Show when={s().status === "waiting"}>
    <text fg={theme.warning}>  [y] confirm</text>
  </Show>
</box>
```

**Step 2: Manual test**

```bash
bun run dev
```
- Select a waiting session
- Verify: `◐ waiting  [y] confirm` appears in the preview header
- Select a running session
- Verify: `● running` appears with NO `[y] confirm`

**Step 3: Commit**

```bash
git add src/tui/routes/home.tsx
git commit -m "feat: show [y] confirm hint in preview header for waiting sessions"
```

---

### Task 4: Visual hints — Footer

**Files:**
- Modify: `src/tui/routes/home.tsx`

**Context:**
The footer is at line ~967. It has a series of `<box flexDirection="column" alignItems="center">` entries. The `updateInfo` entry uses `<Show when={updateInfo()}>` as a pattern for conditional footer items.

**Step 1: Add conditional `y / confirm` entry to footer**

In the footer, add after the `z / hibernate` entry (around line 1008):

```tsx
<Show when={selectedSession()?.status === "waiting"}>
  <box flexDirection="column" alignItems="center">
    <text fg={theme.warning}>y</text>
    <text fg={theme.warning}>confirm</text>
  </box>
</Show>
```

**Step 2: Manual test**

```bash
bun run dev
```
- Select a waiting session — footer should show `y / confirm` in warning color
- Select a non-waiting session — footer entry should disappear

**Step 3: Commit**

```bash
git add src/tui/routes/home.tsx
git commit -m "feat: show y/confirm in footer when waiting session selected"
```

---

## Full Manual Test Checklist

After all tasks are complete:

1. [ ] Preview panel auto-scrolls to bottom when switching sessions
2. [ ] Preview panel auto-scrolls to bottom when content refreshes
3. [ ] Pressing `y` on a waiting session sends Enter and shows "✓ Confirmed" toast
4. [ ] Pressing `y` on a non-waiting session does nothing (no toast, no error)
5. [ ] `[y] confirm` hint visible in preview header only when session is waiting
6. [ ] `y / confirm` visible in footer only when selected session is waiting
7. [ ] Normal `y` typing still works inside dialogs (dialog.stack.length > 0)
