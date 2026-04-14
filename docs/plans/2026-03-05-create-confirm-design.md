# Create Session Confirmation Design

**Date**: 2026-03-05
**Status**: Approved

## Problem

Pressing Enter in the new session dialog immediately creates a session with no review step. Users accidentally trigger creation before finishing their input.

## Design

### Flow

1. User fills the form and presses Enter (or clicks Create Session button)
2. A `DialogSelect` confirmation dialog is pushed, showing a summary of what will be created
3. User selects **Confirm** → actual creation runs
4. User selects **Back** → confirmation dialog closes, form is preserved

### Confirmation Dialog

Title: `"Create session?"`

Summary lines (shown as the dialog title, multi-line):
- `Tool:    <tool>`
- `Title:   <title>` (or `(auto-generated)` if empty)
- `Path:    <path>`
- `Branch:  <branch>` (only when worktree enabled)
- `.claude: will be copied` (only when worktree + claudeDirExists + doCopyClaudeDir)

Options:
- `✅ Confirm` → close dialog + run creation
- `❌ Back` → close dialog, return to form (form state preserved)

### Code Changes

Only `src/tui/component/dialog-new.tsx`:

1. Rename `handleCreate()` → `doCreate()` (the actual async creation logic, unchanged)
2. New `handleCreate()`:
   - Builds a multi-line summary string from current signal values
   - Pushes `DialogSelect` with the summary as title and Confirm/Back options
   - On Confirm: `dialog.clear()` then `doCreate()`
   - On Back: `dialog.pop()`
3. Both Enter key handler and ActionButton already call `handleCreate()` — no change needed there
