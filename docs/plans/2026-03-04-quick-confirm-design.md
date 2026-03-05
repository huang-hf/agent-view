# Quick Confirm Design

**Date**: 2026-03-04
**Status**: Approved

## Problem

When a Claude session requires user confirmation, the current workflow is:
1. Select the session in the list
2. Press Enter to attach into the tmux session
3. Read the confirmation prompt
4. Press Enter to confirm
5. Detach (Ctrl+Q) to return to Agent View

This is slow. The user has to enter/exit tmux just to press Enter.

## Goal

Allow users to confirm a waiting session directly from the home screen without attaching:
1. Select the session (preview auto-scrolls to show latest content)
2. Read the prompt in the right preview panel
3. Press `y` to send Enter to the session

## Design (Approach B)

### 1. Auto-scroll preview to bottom

The preview scrollbox currently has no ref and does not auto-scroll. After each content update, the view stays at whatever scroll position it was previously.

**Change**: Add `previewScrollRef` and call `previewScrollRef.scrollTo(previewScrollRef.scrollHeight || 0)` after content is set, using `setTimeout(0)` to wait for the render cycle.

### 2. `y` key quick confirm

**Trigger conditions**:
- No dialog open (`dialog.stack.length === 0`)
- Selected item is a session with `status === "waiting"`

**Behavior**:
1. Call `sendKeys(session.tmuxSession, "")` — sends Enter to the tmux session
2. Show success toast: `"✓ Confirmed"` (1500ms)
3. Call `sync.refresh()` to update status immediately

**Non-waiting sessions**: silently ignore the `y` key (no error, no toast).

### 3. Visual hints

**PreviewHeader** — when `status === "waiting"`, show `[y] confirm` next to the status badge:
```
bright-fox                        ◐ waiting  [y] confirm
```

**Footer** — conditionally render a `y / confirm` entry when the selected session is waiting.

## Affected Files

Only `src/tui/routes/home.tsx`:
- Declare `let previewScrollRef: ScrollBoxRenderable | undefined`
- Add `ref` to preview scrollbox
- Add scroll-to-bottom call after preview content updates
- Add `y` key handler in `useKeyboard`
- Update `PreviewHeader` to show `[y] confirm` hint when waiting
- Update footer to show `y / confirm` entry conditionally

No changes to `tmux.ts` or any other files.
