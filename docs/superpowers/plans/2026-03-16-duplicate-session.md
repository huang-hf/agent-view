# Duplicate Session Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the existing "fork" feature (Claude-specific conversation history copy) with a universal "duplicate" feature that opens the `DialogNew` form pre-filled with the source session's configuration.

**Architecture:** Remove all fork-specific code from `session.ts`, `sync.tsx`, `dialog-fork.tsx`. Add a `prefill` prop to `DialogNew`. In `home.tsx`, pressing `f` builds a prefill object from the selected session and opens `DialogNew` with it — reusing the normal create flow entirely.

**Tech Stack:** Bun, SolidJS, TypeScript. Build: `bun run build`. No unit tests for UI; build success is the verification.

---

## Chunk 1: Remove fork from core layer

### Task 1: Remove fork methods from `session.ts` and clean up imports

**Files:**
- Modify: `src/core/session.ts`

- [ ] **Step 1: Remove fork-only private helper `getClaudeSessionId`**

  In `src/core/session.ts`, delete the entire `getClaudeSessionId` method (private, ~lines 402–442). It is only called by `fork()` and `canFork()`.

- [ ] **Step 2: Remove `fork()` public method**

  Delete the entire `fork()` method and its private helper `forkClaudeSession()` (~lines 444–562).

- [ ] **Step 3: Remove `canFork()` public method**

  Delete the entire `canFork()` method (~lines 564–575).

- [ ] **Step 4: Clean up imports in `session.ts`**

  On the import line from `"./claude"`, remove `buildForkCommand`, `copySessionToProject`, `sessionFileExists`. Keep `buildClaudeCommand`.

  Before:
  ```ts
  import { buildForkCommand, buildClaudeCommand, copySessionToProject, sessionFileExists } from "./claude"
  ```
  After:
  ```ts
  import { buildClaudeCommand } from "./claude"
  ```

  On the import line from `"./types"`, remove `SessionForkOptions`.

  Before:
  ```ts
  import type { Session, SessionCreateOptions, SessionForkOptions, SessionStatus, Tool, Recent } from "./types"
  ```
  After:
  ```ts
  import type { Session, SessionCreateOptions, SessionStatus, Tool, Recent } from "./types"
  ```

- [ ] **Step 5: Remove `SessionForkOptions` from `src/core/types.ts`**

  Delete lines:
  ```ts
  export interface SessionForkOptions {
    sourceSessionId: string
    title?: string
    preserveHistory?: boolean
    worktreePath?: string
    worktreeRepo?: string
    worktreeBranch?: string
  }
  ```

- [ ] **Step 6: Build to verify no TypeScript errors**

  ```bash
  bun run build
  ```
  Expected: build completes. If errors reference `fork` or `canFork` in other files, note them for next task.

- [ ] **Step 7: Commit**

  ```bash
  git add src/core/session.ts src/core/types.ts
  git commit -m "refactor: remove fork methods from session core"
  ```

---

## Chunk 2: Remove fork from sync layer and UI entry points

### Task 2: Remove fork from `sync.tsx`

**Files:**
- Modify: `src/tui/context/sync.tsx`

- [ ] **Step 1: Remove `fork()` and `canFork()` from the session context object**

  Find and delete these two methods in `src/tui/context/sync.tsx`:
  ```ts
  async fork(options: Parameters<typeof manager.fork>[0]): Promise<Session> {
    const session = await manager.fork(options)
    ...
  },
  async canFork(id: string): Promise<boolean> {
    return manager.canFork(id)
  },
  ```

- [ ] **Step 2: Build to verify**

  ```bash
  bun run build
  ```
  Expected: build completes (or errors only in home.tsx which references these — acceptable, fixed in next task).

- [ ] **Step 3: Commit**

  ```bash
  git add src/tui/context/sync.tsx
  git commit -m "refactor: remove fork/canFork from sync context"
  ```

### Task 3: Remove fork entry points from `home.tsx`

**Files:**
- Modify: `src/tui/routes/home.tsx`

- [ ] **Step 1: Remove `DialogFork` import**

  Delete the line:
  ```ts
  import { DialogFork } from "@tui/component/dialog-fork"
  ```

- [ ] **Step 2: Remove `handleFork()` function**

  Delete the entire `handleFork` async function (~lines 428–460).

- [ ] **Step 3: Remove the `f` key handler (quick fork) and `F` key handler (fork dialog)**

  Replace the two blocks:
  ```ts
  // f to fork (quick)
  if (evt.name === "f" && !evt.shift) { ... }

  // F (Shift+f) to fork with options dialog
  if (evt.name === "f" && evt.shift) { ... }
  ```
  With a single `f` handler that opens `DialogNew` pre-filled (implementation in Task 5). For now, replace with an empty placeholder:
  ```ts
  // f to duplicate — implemented in Task 5
  ```

- [ ] **Step 4: Update footer label**

  In the footer JSX, change:
  ```tsx
  <text fg={theme.textMuted}>fork</text>
  ```
  to:
  ```tsx
  <text fg={theme.textMuted}>dup</text>
  ```

- [ ] **Step 5: Build to verify (expected: error about missing DialogFork file — acceptable)**

  ```bash
  bun run build
  ```

- [ ] **Step 6: Delete `dialog-fork.tsx`**

  ```bash
  rm src/tui/component/dialog-fork.tsx
  ```

- [ ] **Step 7: Remove `DialogFork` export from component index (if present)**

  Check `src/tui/component/index.ts` for a `DialogFork` export and remove it if found.

- [ ] **Step 8: Build to verify clean**

  ```bash
  bun run build
  ```
  Expected: clean build.

- [ ] **Step 9: Commit**

  ```bash
  git add src/tui/routes/home.tsx src/tui/component/index.ts
  git rm src/tui/component/dialog-fork.tsx
  git commit -m "refactor: remove fork UI — dialog-fork, handleFork, f/F handlers"
  ```

---

## Chunk 3: Add duplicate via DialogNew prefill

### Task 4: Add `prefill` prop to `DialogNew`

**Files:**
- Modify: `src/tui/component/dialog-new.tsx`

The `SavedFormState` interface (already defined at top of file) has exactly the fields needed for prefill. We add an optional `prefill` prop; when provided it takes priority over `_savedFormState`.

- [ ] **Step 1: Export `SavedFormState` type**

  Change:
  ```ts
  interface SavedFormState {
  ```
  to:
  ```ts
  export interface SavedFormState {
  ```

- [ ] **Step 2: Add `prefill` prop to `DialogNew`**

  Change the function signature:
  ```ts
  export function DialogNew() {
  ```
  to:
  ```ts
  export function DialogNew(props?: { prefill?: SavedFormState }) {
  ```

- [ ] **Step 3: Use `prefill` as the restore source**

  Change the restore initialization lines at the top of `DialogNew`:
  ```ts
  const restore = _savedFormState
  _savedFormState = null
  ```
  to:
  ```ts
  const restore = props?.prefill ?? _savedFormState
  _savedFormState = null
  ```

- [ ] **Step 4: Build to verify**

  ```bash
  bun run build
  ```
  Expected: clean build.

- [ ] **Step 5: Commit**

  ```bash
  git add src/tui/component/dialog-new.tsx
  git commit -m "feat: add prefill prop to DialogNew for duplicate support"
  ```

### Task 5: Wire up `f` key in `home.tsx` to open DialogNew with prefill

**Files:**
- Modify: `src/tui/routes/home.tsx`

- [ ] **Step 1: Import `SavedFormState` and `DialogNew` (already imported)**

  Add import of `SavedFormState` from `dialog-new`:
  ```ts
  import { DialogNew, SavedFormState } from "@tui/component/dialog-new"
  ```
  (Replace the existing `import { DialogNew }` line.)

- [ ] **Step 2: Replace the placeholder `f` handler with the duplicate implementation**

  Replace:
  ```ts
  // f to duplicate — implemented in Task 5
  ```
  With:
  ```ts
  // f to duplicate session
  if (evt.name === "f" && !evt.shift) {
    const session = selectedSession()
    if (!session) return

    const remoteHosts = getConfig().remoteHosts ?? []
    const hostIndex = session.remoteHost
      ? remoteHosts.findIndex(h => h.alias === session.remoteHost)
      : 0

    const TOOLS = ["claude", "opencode", "gemini", "codex", "custom", "shell"]
    const toolIndex = Math.max(0, TOOLS.indexOf(session.tool))

    const prefill: SavedFormState = {
      title: `${session.title}-fork`,
      selectedTool: session.tool,
      toolIndex,
      claudeSessionMode: "new",
      skipPermissions: false,
      customCommand: session.command ?? "",
      projectPath: session.projectPath,
      useWorktree: false,
      worktreeBranch: "",
      selectedRemoteHost: session.remoteHost ?? "",
      hostIndex: hostIndex >= 0 ? hostIndex : 0,
    }
    dialog.push(() => <DialogNew prefill={prefill} />)
  }
  ```

  > **Note:** `TOOLS` order must match the `TOOLS` array in `dialog-new.tsx`:
  > `["claude", "opencode", "gemini", "codex", "custom", "shell"]`

- [ ] **Step 3: Add missing import for `getConfig`**

  If `getConfig` is not already imported in `home.tsx`, add:
  ```ts
  import { getConfig } from "@/core/config"
  ```

- [ ] **Step 4: Build to verify**

  ```bash
  bun run build
  ```
  Expected: clean build, no TypeScript errors.

- [ ] **Step 5: Commit**

  ```bash
  git add src/tui/routes/home.tsx
  git commit -m "feat: implement duplicate session via f key with prefilled DialogNew"
  ```

---

## Chunk 4: Final verification and push

### Task 6: End-to-end verification

- [ ] **Step 1: Run the app and test duplicate**

  ```bash
  bun run dev
  ```

  Test steps:
  1. Open a session in the home screen
  2. Press `f`
  3. Verify `DialogNew` opens with fields pre-filled (correct tool, path, title ending in `-fork`)
  4. Press Enter or fill any field and confirm
  5. Verify a new session is created and appears in the list

- [ ] **Step 2: Verify fork is gone**

  - Press `F` (Shift+f) — should do nothing or not open the old fork dialog
  - Check that no "fork" errors appear in logs

- [ ] **Step 3: Push to fork remote**

  ```bash
  git push fork main
  ```
