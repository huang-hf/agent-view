# Create Session Confirmation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a confirmation step when creating a new session — pressing Enter shows a summary dialog before actually creating.

**Architecture:** Rename `handleCreate()` to `doCreate()`, add a new `handleCreate()` that pushes a `DialogSelect` summary, and on "Confirm" calls `doCreate()`. Both the Enter key handler and the ActionButton already call `handleCreate()` — no changes needed there.

**Tech Stack:** Solid.js, existing `DialogSelect` component (`@tui/ui/dialog-select`).

---

### Task 1: Add confirmation dialog to new session flow

**Files:**
- Modify: `src/tui/component/dialog-new.tsx`

**Context:**
- `handleCreate()` is at line ~205. It is called at line ~320 (Enter key) and line ~649 (`ActionButton`).
- `DialogSelect` is NOT currently imported in this file. It is imported in `home.tsx` as: `import { DialogSelect } from "@tui/ui/dialog-select"`
- Available signals at call time: `title()`, `selectedTool()`, `projectPath()`, `useWorktree()`, `worktreeBranch()`, `claudeDirExists()`, `doCopyClaudeDir()`
- `dialog` is already available via `const dialog = useDialog()`

---

**Step 1: Add DialogSelect import**

Find the existing imports block at the top of `src/tui/component/dialog-new.tsx`. After the line:
```ts
import { useDialog, scrollDialogBy, scrollDialogTo } from "@tui/ui/dialog"
```
Add:
```ts
import { DialogSelect } from "@tui/ui/dialog-select"
```

---

**Step 2: Rename handleCreate → doCreate**

Find line ~205:
```ts
async function handleCreate() {
```
Rename to:
```ts
async function doCreate() {
```

This function body stays **completely unchanged**. Only the name changes.

---

**Step 3: Add the new handleCreate() function**

Add this new function immediately **after** the closing `}` of `doCreate()`:

```ts
function handleCreate() {
  // Build summary lines for the confirmation dialog
  const lines: string[] = []
  lines.push(`Tool:   ${selectedTool()}`)
  const t = title().trim()
  lines.push(`Title:  ${t || "(auto-generated)"}`)
  lines.push(`Path:   ${projectPath() || process.cwd()}`)
  if (useWorktree()) {
    const branch = worktreeBranch().trim()
    lines.push(`Branch: ${branch || "(auto-generated)"}`)
    if (claudeDirExists() && doCopyClaudeDir()) {
      lines.push(`.claude: will be copied`)
    }
  }

  dialog.push(() => (
    <DialogSelect
      title={`Create session?\n\n${lines.join("\n")}`}
      options={[
        { title: "✅ Confirm", value: "confirm" },
        { title: "❌ Back", value: "back" },
      ]}
      onSelect={(opt) => {
        dialog.pop()
        if (opt.value === "confirm") {
          doCreate()
        }
      }}
    />
  ))
}
```

---

**Step 4: Build check**
```bash
cd /Users/huanghuifeng/workspace/agent-view
bun run build
```
Expected: Build successful, no TypeScript errors.

---

**Step 5: Manual test**
```bash
bun run dev
```
- Press `n` to open new session dialog
- Fill in some fields, press Enter
- Confirm dialog appears with a summary of the entered values
- Select **Back** → returns to the form with all values preserved
- Press Enter again, select **Confirm** → session is created normally
- Verify the ActionButton ("Create Session") also shows the confirmation dialog

---

**Step 6: Run tests**
```bash
bun test
```
Expected: All 140 tests pass.

---

**Step 7: Commit**
```bash
git add src/tui/component/dialog-new.tsx
git commit -m "feat: add confirmation dialog before creating new session"
```
