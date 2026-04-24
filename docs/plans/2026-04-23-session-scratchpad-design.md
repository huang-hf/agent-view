# Design: Session Scratchpad Popup

**Date:** 2026-04-23

## Summary

Replace the current per-session TODO sidebar and dialog with a per-session scratchpad that is available while attached to a session. The scratchpad opens via `Ctrl+T` in the attached tmux session using `tmux display-popup`, supports normal multi-line editing and partial text selection/copy, and persists content separately for each session.

## Motivation

The existing TODO UI only exists inside the Agent View TUI session detail page. That does not match the real usage pattern: users need to jot down temporary notes while actively working inside an attached session. Once attach starts, the TUI is suspended and the TODO UI disappears exactly when the note-taking affordance is needed most.

The new scratchpad should optimize for:

- fast access while attached
- free-form multi-line notes instead of queued TODO items
- per-session isolation
- normal terminal editor behavior for selection and copy

## User Flow

1. User attaches to a session.
2. While working inside the attached tmux session, user presses `Ctrl+T`.
3. Agent View opens a tmux popup at a medium size over the current terminal.
4. The popup opens the current session's scratchpad file in a terminal editor.
5. User writes or edits notes, selects part of the content if needed, and copies text using normal terminal/editor behavior.
6. User closes the popup and returns to the attached session exactly where they were working.
7. Pressing `Ctrl+T` again for the same session reopens the same persisted content.
8. Attaching to a different session opens that session's separate scratchpad.

## Approach Options

### Recommended: tmux popup + editor-backed scratchpad

Use `tmux display-popup` to open a session-specific text file in a real terminal editor.

Pros:
- closest match to the desired "small popup" interaction
- multi-line editing comes for free
- partial selection/copy is delegated to the user's normal terminal/editor behavior
- low implementation risk

Cons:
- requires picking and invoking an editor
- behavior depends slightly on local environment/editor config

### Alternative: custom TUI popup editor

Implement a custom editor inside Agent View.

Pros:
- full control over interaction and theming

Cons:
- much more implementation complexity
- terminal selection/copy behavior is harder to make feel natural
- reimplements editor functionality poorly compared with mature tools

### Alternative: split-pane notes

Open notes in a persistent tmux split instead of a popup.

Pros:
- easy to keep visible

Cons:
- does not match the requested temporary popup workflow
- permanently consumes screen space

## Interaction Design

- Trigger: `Ctrl+T` while attached to a session
- Existing tmux meaning for `Ctrl+T`: remove it and replace it with scratchpad
- Presentation: centered tmux popup, medium-sized
- Recommended size: about 70% width and 70% height of the current terminal
- Exit behavior: closing the popup returns directly to the original attached session

The popup should feel lightweight and temporary, not like a full-screen mode switch.

## Data Model

Each session owns one scratchpad text document.

Recommended storage model:

- directory: a dedicated local scratchpad directory managed by Agent View
- filename: session id based, for example `<sessionId>.md`
- content format: markdown-compatible plain text

Rationale:

- the new feature is free-form text, not a list of queue items
- file-backed storage is a natural fit for editor-based workflows
- files are simpler to open directly from tmux than serialized metadata blobs

## Editor Selection

Editor resolution order:

1. `$EDITOR`
2. `nano`
3. `vi`

The command should open the resolved editor directly on the scratchpad file from inside the tmux popup.

## Scope Changes

### Remove

- session detail right-side TODO sidebar
- TODO dialog
- TODO queue storage model and related UI entry points

### Add

- per-session scratchpad storage
- tmux popup command for opening scratchpad while attached
- `Ctrl+T` binding for scratchpad

## Error Handling

- If `tmux display-popup` is unavailable, show a clear error and leave the current session intact.
- If no editor can be resolved, show a clear error and do not interrupt the session.
- If the scratchpad file does not exist yet, create an empty file automatically.
- If a session is deleted, delete its scratchpad file as part of cleanup.

Errors should never strand the user outside their attached session.

## Non-Goals

- no rich TODO queue semantics
- no attach-time sidebar inside the existing TUI
- no global shared scratchpad across all sessions
- no custom editor implementation inside Agent View

## Validation

1. Attach to session A.
2. Press `Ctrl+T` and confirm a medium popup opens.
3. Enter multiple lines of text.
4. Select and copy part of the text using normal terminal/editor behavior.
5. Close the popup and confirm the original attached session is still active.
6. Reopen with `Ctrl+T` and confirm the content persists.
7. Attach to session B and confirm it has a different scratchpad.
8. Delete a session and confirm its scratchpad file is removed.
9. Confirm the old TODO sidebar and dialog are no longer visible or reachable.

## Files Likely Affected

- `src/core/tmux.ts`
- `src/core/session.ts`
- `src/core/todo.ts` or replacement scratchpad storage module
- `src/tui/routes/session/index.tsx`
- `src/tui/routes/session/sidebar-todo.tsx`
- `src/tui/component/dialog-todo.tsx`
- any attach-time keybinding upload or tmux binding setup code in the SSH/tmux integration
