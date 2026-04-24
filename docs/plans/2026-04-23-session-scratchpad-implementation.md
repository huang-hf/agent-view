# Session Scratchpad Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current session TODO UI with a per-session scratchpad popup that opens from attached tmux sessions via `Ctrl+T`.

**Architecture:** Persist one markdown scratchpad file per session on disk, add tmux helpers that open the current session scratchpad in a popup editor, wire the attach flow to install a `Ctrl+T` binding for the current session, and remove the obsolete TODO sidebar/dialog/storage code. Keep the implementation file-backed and editor-driven rather than building a custom TUI editor.

**Tech Stack:** TypeScript, Solid/OpenTUI, tmux, Node.js fs/path/child_process, Vitest

---

### Task 1: Add scratchpad storage module

**Files:**
- Create: `src/core/scratchpad.ts`
- Test: `src/core/scratchpad.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests covering:
- resolving the per-session scratchpad path
- creating the scratchpad directory/file lazily
- deleting the scratchpad file for a session
- editor resolution order: `$EDITOR` then `nano` then `vi`

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/core/scratchpad.test.ts`
Expected: FAIL because the module does not exist yet

- [ ] **Step 3: Write minimal implementation**

Implement:
- scratchpad directory resolution
- `getScratchpadPath(sessionId)`
- `ensureScratchpad(sessionId)`
- `deleteScratchpad(sessionId)`
- `resolveScratchpadEditor(env, commandExists)`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/core/scratchpad.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/scratchpad.ts src/core/scratchpad.test.ts
git commit -m "feat: add session scratchpad storage"
```

### Task 2: Add tmux popup helpers for scratchpad

**Files:**
- Modify: `src/core/tmux.ts`
- Test: `src/core/tmux.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests covering:
- popup command construction for a given session scratchpad path
- `Ctrl+T` binding payload using popup open command
- replacement of the previous `Ctrl+T` meaning

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/core/tmux.test.ts`
Expected: FAIL on missing scratchpad popup helpers

- [ ] **Step 3: Write minimal implementation**

Implement helpers to:
- open a scratchpad popup for a given session
- produce a tmux binding snippet or command for `Ctrl+T`
- use a medium popup size
- invoke the resolved editor on the session scratchpad file

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/core/tmux.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/tmux.ts src/core/tmux.test.ts
git commit -m "feat: add tmux scratchpad popup support"
```

### Task 3: Wire scratchpad binding into local and remote attach flows

**Files:**
- Modify: `src/core/session.ts`
- Modify: `src/core/ssh.ts`
- Modify: `src/tui/routes/home.tsx`
- Modify: `src/tui/component/dialog-sessions.tsx`
- Test: existing attach-related tests where appropriate

- [ ] **Step 1: Write the failing tests**

Add or update tests covering:
- attach setup installs the scratchpad-aware `Ctrl+T` behavior
- remote attach upload/setup uses the new binding
- no stale TODO-specific behavior remains in attach setup

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/core/ssh.test.ts src/core/tmux.test.ts`
Expected: FAIL on missing scratchpad binding integration

- [ ] **Step 3: Write minimal implementation**

Update attach-time setup so:
- local attach uses the new `Ctrl+T` scratchpad behavior
- remote attach uploads/applies the same binding
- errors preserve the current attach workflow when popup/editor setup cannot run

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/core/ssh.test.ts src/core/tmux.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/session.ts src/core/ssh.ts src/tui/routes/home.tsx src/tui/component/dialog-sessions.tsx src/core/ssh.test.ts src/core/tmux.test.ts
git commit -m "feat: bind scratchpad popup during attach"
```

### Task 4: Remove old TODO UI and storage

**Files:**
- Delete: `src/core/todo.ts`
- Delete: `src/tui/component/dialog-todo.tsx`
- Delete: `src/tui/routes/session/sidebar-todo.tsx`
- Modify: `src/tui/routes/session/index.tsx`
- Modify: any remaining imports/usages discovered by search

- [ ] **Step 1: Write the failing test or search check**

Use a repository search check to confirm old TODO modules are still referenced.

- [ ] **Step 2: Run the failing search**

Run: `rg -n "DialogTodo|TodoSidebar|listTodos|addTodo|removeTodo|todo_queue" src -S`
Expected: matches still exist

- [ ] **Step 3: Write minimal implementation**

Remove:
- session sidebar rendering
- TODO dialog component
- TODO storage module
- all imports and dead references

- [ ] **Step 4: Run the search to verify cleanup**

Run: `rg -n "DialogTodo|TodoSidebar|listTodos|addTodo|removeTodo|todo_queue" src -S`
Expected: no matches

- [ ] **Step 5: Commit**

```bash
git add src/tui/routes/session/index.tsx
git rm src/core/todo.ts src/tui/component/dialog-todo.tsx src/tui/routes/session/sidebar-todo.tsx
git commit -m "refactor: remove obsolete session todo ui"
```

### Task 5: Verify end-to-end behavior

**Files:**
- Modify: implementation files only if verification reveals gaps

- [ ] **Step 1: Run focused automated tests**

Run: `npm test -- src/core/scratchpad.test.ts src/core/tmux.test.ts src/core/ssh.test.ts`
Expected: PASS

- [ ] **Step 2: Run broader regression coverage**

Run: `npm test -- src/core/session-status.test.ts src/tui/util/session.test.ts`
Expected: PASS

- [ ] **Step 3: Perform manual workflow verification**

Check:
- attach to a session
- trigger `Ctrl+T`
- popup opens at medium size
- scratchpad content persists per session
- old TODO UI is absent

- [ ] **Step 4: Commit final fixes if needed**

```bash
git add <files>
git commit -m "test: verify session scratchpad workflow"
```
