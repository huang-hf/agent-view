# Worktree UX Improvements Design

**Date**: 2026-03-05
**Status**: Approved

## Problem

Two UX issues in the new session dialog:

1. **Path field Enter confusion**: The footer hint says "Tab | Enter: create", giving no indication that Tab/→ are needed to confirm autocomplete suggestions. Users naturally press Enter expecting to confirm a path selection, but it creates the session instead.

2. **No .claude sync to worktree**: When creating a session in a git worktree, Claude Code in the worktree doesn't have access to the project's `.claude/` directory (CLAUDE.md, MCP configs, commands). Users have to manually copy it.

## Design

### Feature 1: Dynamic hint for path field

**Change**: In `dialog-new.tsx`, make the `DialogFooter` hint dynamic based on `focusedField()`.

- When `focusedField()` is `"path"` or `"branch"`: show `"↓↑ browse | Tab/→ select | Enter create"`
- Otherwise: show the default `"Tab | Enter: create"`

**Files**: `src/tui/component/dialog-new.tsx` only (one-line change to the hint prop).

### Feature 2: Copy .claude directory to worktree

**New checkbox** in the worktree section of the new session dialog:
- Label: `Copy .claude directory`
- Visible only when: `useWorktree()` is true AND `<repoRoot>/.claude` exists on disk
- Default: checked (most users need it)
- Field name: `copyClaudeDir` (boolean signal)

**New function** in `src/core/git.ts`:
```ts
export async function copyClaudeDir(repoRoot: string, worktreePath: string): Promise<void>
```
Uses Node's `fs.cp` (recursive) to copy `<repoRoot>/.claude` → `<worktreePath>/.claude`.
Silently skips if source doesn't exist.

**Session creation flow** in `dialog-new.tsx`:
After `createWorktree(...)` succeeds, if `copyClaudeDir` signal is true, call `copyClaudeDir(repoRoot, worktreePath)`.

**Focus field**: Add `"copyClaudeDir"` to `FocusField` type and `getFocusableFields()` so it's reachable via Tab navigation. Toggle with Space key (same pattern as `worktree`, `resumeSession`, `skipPermissions`).

## Files Changed

- `src/core/git.ts` — add `copyClaudeDir` function
- `src/tui/component/dialog-new.tsx` — dynamic hint + copyClaudeDir checkbox + creation logic
