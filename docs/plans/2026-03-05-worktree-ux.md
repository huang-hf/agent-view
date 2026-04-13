# Worktree UX Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix two UX issues in the new session dialog: add a context-sensitive hint when the path field is focused, and add a "Copy .claude directory" checkbox when creating a worktree session.

**Architecture:** Task 1 touches only `dialog-new.tsx` (one-line hint change). Task 2 adds `copyClaudeDir()` to `git.ts`. Task 3 wires the checkbox into `dialog-new.tsx` using the same checkbox patterns already used for `worktree`, `resumeSession`, and `skipPermissions`.

**Tech Stack:** Solid.js signals/effects, Node `fs/promises` (`cp` with `recursive: true`), existing `existsSync` for directory detection.

---

### Task 1: Dynamic footer hint for path/branch fields

**Files:**
- Modify: `src/tui/component/dialog-new.tsx` (line ~613)

**Context:**
Line 613 currently reads:
```tsx
<DialogFooter hint={creating() ? statusMessage() : "Tab | Enter: create"} />
```
`focusedField()` is a Solid signal already available in this component.

**Step 1: Change the hint to be dynamic**

Find line 613 and replace:
```tsx
<DialogFooter hint={creating() ? statusMessage() : "Tab | Enter: create"} />
```
With:
```tsx
<DialogFooter hint={creating() ? statusMessage() : (focusedField() === "path" || focusedField() === "branch") ? "↓↑ browse | Tab/→ select | Enter create" : "Tab | Enter: create"} />
```

**Step 2: Build check**
```bash
bun run build
```
Expected: Build successful, no TypeScript errors.

**Step 3: Manual test**
```bash
bun run dev
```
- Press `n` to open new session dialog
- Tab to the Project Path field → footer should show `↓↑ browse | Tab/→ select | Enter create`
- Tab away from path field → footer should show `Tab | Enter: create`
- Enable worktree, Tab to Branch name field → footer should show `↓↑ browse | Tab/→ select | Enter create`

**Step 4: Commit**
```bash
git add src/tui/component/dialog-new.tsx
git commit -m "feat: show autocomplete hint in footer when path/branch field focused"
```

---

### Task 2: Add copyClaudeDir function to git.ts

**Files:**
- Modify: `src/core/git.ts`

**Context:**
`git.ts` already imports `path` from `"path"` and uses `execAsync`. Add a new exported function at the bottom of the file. Use `fs/promises` `cp` for recursive copy.

**Step 1: Add the import**

At the top of `src/core/git.ts`, the existing imports look like:
```ts
import path from "path"
import { promisify } from "util"
import { exec } from "child_process"
import { existsSync } from "fs"
```

Add `cp` to the fs imports:
```ts
import { existsSync } from "fs"
import { cp } from "fs/promises"
```

**Step 2: Add the function at the bottom of git.ts**

```ts
/**
 * Copy the .claude directory from the repo root into a worktree.
 * No-op if the source directory does not exist.
 */
export async function copyClaudeDir(repoRoot: string, worktreePath: string): Promise<void> {
  const src = path.join(repoRoot, ".claude")
  const dest = path.join(worktreePath, ".claude")
  if (!existsSync(src)) return
  await cp(src, dest, { recursive: true })
}
```

**Step 3: Build check**
```bash
bun run build
```
Expected: Build successful.

**Step 4: Run tests**
```bash
bun test
```
Expected: All 140 tests pass (no new tests needed — `copyClaudeDir` is a thin wrapper around `fs.cp` which we trust; edge cases are covered by the `existsSync` guard).

**Step 5: Commit**
```bash
git add src/core/git.ts
git commit -m "feat: add copyClaudeDir utility to git.ts"
```

---

### Task 3: Copy .claude checkbox in dialog-new

**Files:**
- Modify: `src/tui/component/dialog-new.tsx`

**Context:**
The dialog already has a pattern for checkbox fields: `useWorktree`, `resumeSession`, `skipPermissions`. Follow it exactly. Key locations:
- `FocusField` type: line 64
- Signals block: lines ~81-109
- `createEffect` that checks git repo (lines ~122-143): extend to also check if `.claude` exists
- `getFocusableFields()`: lines ~175-192
- Space key handler block: lines ~366-390
- Worktree UI section: lines ~530-590 (add checkbox after branch/develop section)
- `handleCreate()`: lines ~228-249 (call `copyClaudeDir` after worktree creation)
- Import section: add `copyClaudeDir` from `@/core/git`

**Step 1: Add `copyClaudeDir` to FocusField type**

Line 64, change:
```ts
type FocusField = "title" | "tool" | "resumeSession" | "skipPermissions" | "customCommand" | "path" | "worktree" | "branch"
```
To:
```ts
type FocusField = "title" | "tool" | "resumeSession" | "skipPermissions" | "customCommand" | "path" | "worktree" | "branch" | "copyClaudeDir"
```

**Step 2: Add signals**

After the `const [developExists, setDevelopExists] = createSignal(false)` line, add:
```ts
const [claudeDirExists, setClaudeDirExists] = createSignal(false)
const [doCopyClaudeDir, setDoCopyClaudeDir] = createSignal(true)
```

**Step 3: Add import for copyClaudeDir**

Find the git import line (around line 15-20):
```ts
import { isGitRepo, getRepoRoot, branchExists, createWorktree, generateWorktreePath, generateBranchName, sanitizeBranchName } from "@/core/git"
```
Add `copyClaudeDir` to it:
```ts
import { isGitRepo, getRepoRoot, branchExists, createWorktree, generateWorktreePath, generateBranchName, sanitizeBranchName, copyClaudeDir } from "@/core/git"
```

**Step 4: Detect .claude existence in the git createEffect**

The existing `createEffect` (lines ~122-143) already runs when `projectPath()` changes. In the `else` branch (when it IS a git repo), after `setDevelopExists(hasDevelop)`, add:

```ts
const hasClaude = existsSync(path.join(repoRoot, ".claude"))
setClaudeDirExists(hasClaude)
if (!hasClaude) setDoCopyClaudeDir(false)
```

In the `catch` block and the `if (!result)` block, add `setClaudeDirExists(false)`.

Full updated effect:
```ts
createEffect(async () => {
  const path = projectPath()
  try {
    const result = await isGitRepo(path)
    setIsInGitRepo(result)
    if (!result) {
      setUseWorktree(false)
      setDevelopExists(false)
      setUseBaseDevelop(false)
      setClaudeDirExists(false)
    } else {
      const repoRoot = await getRepoRoot(path)
      const hasDevelop = await branchExists(repoRoot, "develop")
      setDevelopExists(hasDevelop)
      if (!hasDevelop) {
        setUseBaseDevelop(false)
      }
      const hasClaude = existsSync(pathModule.join(repoRoot, ".claude"))
      setClaudeDirExists(hasClaude)
      if (!hasClaude) setDoCopyClaudeDir(false)
    }
  } catch {
    setIsInGitRepo(false)
    setUseWorktree(false)
    setDevelopExists(false)
    setUseBaseDevelop(false)
    setClaudeDirExists(false)
  }
})
```

Note: `path` is used as a variable name in this effect AND as the `path` module. Check existing code — if there's a naming conflict, the module is imported as `import path from "path"`. The variable in the effect is `const path = projectPath()`. Rename the variable to `const dir = projectPath()` and update its usages in the effect to avoid shadowing. Check for this and fix if needed.

**Step 5: Add to getFocusableFields()**

In `getFocusableFields()`, after the `if (useWorktree()) { fields.push("branch") }` block, add:
```ts
if (useWorktree() && claudeDirExists()) {
  fields.push("copyClaudeDir")
}
```

**Step 6: Add Space key handler**

In the `useKeyboard` handler, find the block for `skipPermissions` space toggle (around line 385):
```ts
if (focusedField() === "skipPermissions" && evt.name === "space") {
  evt.preventDefault()
  setSkipPermissions(!skipPermissions())
}
```
After it, add:
```ts
if (focusedField() === "copyClaudeDir" && evt.name === "space") {
  evt.preventDefault()
  setDoCopyClaudeDir(!doCopyClaudeDir())
  return
}
```

**Step 7: Add checkbox UI**

In the worktree section, after the `<Show when={developExists()}>...</Show>` block and before the closing `</Show>` of `<Show when={useWorktree()}>`, add:

```tsx
{/* Copy .claude directory toggle */}
<Show when={claudeDirExists()}>
  <box
    flexDirection="row"
    gap={1}
    paddingLeft={4}
    onMouseUp={() => {
      setFocusedField("copyClaudeDir")
      setDoCopyClaudeDir(!doCopyClaudeDir())
    }}
  >
    <text fg={focusedField() === "copyClaudeDir" ? theme.primary : theme.textMuted}>
      {doCopyClaudeDir() ? "[x]" : "[ ]"}
    </text>
    <text fg={focusedField() === "copyClaudeDir" ? theme.text : theme.textMuted}>
      Copy .claude directory
    </text>
  </box>
</Show>
```

**Step 8: Call copyClaudeDir in handleCreate()**

In `handleCreate()`, after the line `worktreePath = await createWorktree(...)` and before `sessionProjectPath = worktreePath`, add:

```ts
worktreePath = await createWorktree(repoRoot, branchName, wtPath, baseBranch)
if (doCopyClaudeDir() && claudeDirExists()) {
  await copyClaudeDir(repoRoot, worktreePath)
}
sessionProjectPath = worktreePath
```

**Step 9: Build check**
```bash
bun run build
```
Expected: Build successful, no TypeScript errors.

**Step 10: Manual test**
```bash
bun run dev
```
- Press `n`, enter a project path that IS a git repo with a `.claude` dir
- Enable worktree checkbox → `Copy .claude directory [x]` should appear (checked by default)
- Tab to `copyClaudeDir` field, press Space → should toggle to `[ ]`
- Create the session → verify `.claude` was copied to the worktree path
- Repeat with `[ ]` → verify `.claude` was NOT copied

**Step 11: Commit**
```bash
git add src/tui/component/dialog-new.tsx
git commit -m "feat: add copy .claude directory option when creating worktree session"
```
