# Design: Replace Fork with Duplicate Session

**Date:** 2026-03-16

## Summary

Remove the existing "fork" feature (which copies Claude conversation history) and replace it with a simpler "duplicate" feature that pre-fills the `DialogNew` form with the source session's configuration, creating a completely fresh session.

## Motivation

Fork is Claude-specific and complex. Duplicate is universal (works with any tool) and conceptually simple: copy the config, start fresh.

## User Flow

1. User selects a session in the home screen and presses `f`
2. `DialogNew` opens pre-filled with the source session's config
3. User can review and optionally modify any field
4. User confirms → new session created via the normal creation path

## Implementation

### Files to Delete
- `src/tui/component/dialog-fork.tsx` — entire file

### Files to Modify

**`src/tui/component/dialog-new.tsx`**
- Add optional `prefill?: SavedFormState` prop to `DialogNew`
- When `prefill` is provided, use it instead of `_savedFormState`
- `SavedFormState` is already exported-compatible (rename to export if needed)

**`src/tui/routes/home.tsx`**
- Remove `import { DialogFork }` line
- Remove `handleFork()` function (~30 lines)
- Replace `f` key handler (fork) with: build prefill object from selected session, push `DialogNew` with `prefill`
- Remove `F` (Shift+f) key handler (fork dialog)
- Update footer: `f fork` → `f dup`

**`src/tui/context/sync.tsx`**
- Remove `fork()` method from session context
- Remove `canFork()` method from session context

**`src/core/session.ts`**
- Remove `fork()` public method
- Remove `forkClaudeSession()` private method
- Remove `canFork()` method
- Remove `SessionForkOptions` type (if defined here)
- Remove `buildForkCommand` usage (if only used by fork)

### Prefill Mapping

When `f` is pressed on a session, build `SavedFormState` as follows:

| SavedFormState field | Source |
|---|---|
| `title` | `session.title + "-fork"` |
| `selectedTool` | `session.tool` |
| `toolIndex` | `TOOLS.findIndex(t => t.value === session.tool)` |
| `customCommand` | `session.command ?? ""` |
| `projectPath` | `session.projectPath` |
| `claudeSessionMode` | `"new"` |
| `skipPermissions` | `false` |
| `useWorktree` | `false` |
| `worktreeBranch` | `""` |
| `selectedRemoteHost` | `session.remoteHost ?? ""` |
| `hostIndex` | index of remoteHost in config, or `0` |

## What Does NOT Change

- Session creation logic (`session.ts create()`) — untouched
- `DialogNew` layout and UX — unchanged, just pre-filled
- All other keybindings

## Files Affected

1. `src/tui/component/dialog-fork.tsx` — deleted
2. `src/tui/component/dialog-new.tsx` — add `prefill` prop
3. `src/tui/routes/home.tsx` — replace fork with duplicate entry point
4. `src/tui/context/sync.tsx` — remove fork/canFork
5. `src/core/session.ts` — remove fork methods
