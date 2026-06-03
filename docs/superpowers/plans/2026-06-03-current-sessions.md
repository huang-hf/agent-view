# Current Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only virtual `Current` group to the TUI home screen showing the 10 most recently accessed active sessions.

**Architecture:** Keep `Current` out of storage and build it from existing sessions at render time. Add focused utilities for selecting current sessions and composing grouped list rows, then update the TUI home route to render and protect the virtual group header. Update `SessionManager.attach()` so attach counts as user access.

**Tech Stack:** Bun, TypeScript, Solid JSX, OpenTUI, `bun:test`.

---

## File Structure

- Modify `src/tui/util/session.ts`: add `getCurrentSessions()` and constants for default limit and active statuses.
- Modify `src/tui/util/session.test.ts`: add unit coverage for current-session selection.
- Modify `src/tui/util/groups.ts`: add virtual `Current` grouped item support and a helper to prepend it to real grouped items.
- Modify `src/tui/util/groups.test.ts`: add unit coverage for `Current` group insertion and numeric group indexes.
- Modify `src/tui/routes/home.tsx`: use the new grouped helper, render the virtual group header, and ignore group-only actions on it.
- Modify `src/core/session.ts`: update `last_accessed` before attach.
- Modify `src/core/session.test.ts` or existing session tests: cover attach updating `lastAccessed` if the current test harness supports it.

## Task 1: Current Session Selection Utility

**Files:**
- Modify: `src/tui/util/session.ts`
- Modify: `src/tui/util/session.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that verify:

- `getCurrentSessions()` keeps `running`, `waiting`, and `idle`.
- It excludes `stopped` and `hibernated`.
- It sorts by `lastAccessed` descending.
- It defaults to 10 items.
- It accepts an explicit limit.

- [ ] **Step 2: Run focused test**

Run: `bun test src/tui/util/session.test.ts`

Expected: FAIL because `getCurrentSessions` is not implemented.

- [ ] **Step 3: Implement utility**

Add:

```ts
export const CURRENT_SESSIONS_LIMIT = 10
export const CURRENT_SESSION_STATUSES = new Set(["running", "waiting", "idle"])

export function getCurrentSessions(
  sessions: Session[],
  options: { limit?: number } = {}
): Session[] {
  const limit = options.limit ?? CURRENT_SESSIONS_LIMIT
  return [...sessions]
    .filter((session) => CURRENT_SESSION_STATUSES.has(session.status))
    .sort((a, b) => b.lastAccessed.getTime() - a.lastAccessed.getTime())
    .slice(0, limit)
}
```

- [ ] **Step 4: Run focused test**

Run: `bun test src/tui/util/session.test.ts`

Expected: PASS.

## Task 2: Virtual Current Group Rows

**Files:**
- Modify: `src/tui/util/groups.ts`
- Modify: `src/tui/util/groups.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests for a helper such as:

```ts
prependCurrentGroup(
  groupedItems: GroupedItem[],
  currentSessions: Session[],
  expanded?: boolean
): GroupedItem[]
```

Verify:

- Empty current sessions return the original list.
- Non-empty current sessions add a `Current` header before real groups.
- Current session rows are marked as virtual/current rows.
- Real group `groupIndex` values remain unchanged.
- Collapsed current group renders only the Current header.

- [ ] **Step 2: Run focused test**

Run: `bun test src/tui/util/groups.test.ts`

Expected: FAIL because the helper/types are not implemented.

- [ ] **Step 3: Implement virtual group support**

Extend `GroupedItem` with optional fields:

```ts
isVirtual?: boolean
virtualType?: "current"
isCurrent?: boolean
```

Add constants:

```ts
export const CURRENT_GROUP_PATH = "__current__"
export const CURRENT_GROUP_NAME = "Current"
```

Add `prependCurrentGroup()` that creates a virtual group item and optional session rows without assigning a numeric `groupIndex`.

- [ ] **Step 4: Run focused test**

Run: `bun test src/tui/util/groups.test.ts`

Expected: PASS.

## Task 3: TUI Home Integration

**Files:**
- Modify: `src/tui/routes/home.tsx`

- [ ] **Step 1: Wire the grouped list**

Import `getCurrentSessions` and `prependCurrentGroup`. Add a local signal for current group expanded state, defaulting to `true`.

Build the list as:

```ts
const realGroupedItems = flattenGroupTree(allSessions(), groups)
return prependCurrentGroup(realGroupedItems, getCurrentSessions(allSessions()), currentExpanded())
```

- [ ] **Step 2: Render virtual header**

Update `GroupHeader` to accept `GroupedItem` or virtual metadata so it can render `Current` without requiring a real `Group`. Show status counts based on the current sessions.

- [ ] **Step 3: Protect group-only actions**

For selected virtual group headers:

- `Enter`, `h`, `l`, left arrow, and right arrow toggle `currentExpanded`.
- `d`, `R`, and other group management actions do nothing or show a short toast.
- Number keys still use existing real group indexes.

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
bun test src/tui/util/session.test.ts src/tui/util/groups.test.ts
bun run typecheck
```

Expected: PASS.

## Task 4: Attach Updates `lastAccessed`

**Files:**
- Modify: `src/core/session.ts`
- Modify: `src/core/session.test.ts` if practical

- [ ] **Step 1: Write or update failing test**

Cover `SessionManager.attach(sessionId)` updating `lastAccessed` when it starts attach. If the attach test harness cannot safely mock terminal attach, document why and cover this through the existing attach test.

- [ ] **Step 2: Run focused test**

Run: `bun test src/core/session.test.ts`

Expected: FAIL before implementation if a new assertion was added.

- [ ] **Step 3: Implement timestamp update**

In `SessionManager.attach()`, after validating the session and before `spawnAttach`, update:

```ts
storage.updateSessionField(sessionId, "last_accessed", Date.now())
storage.touch()
```

- [ ] **Step 4: Run focused test**

Run: `bun test src/core/session.test.ts`

Expected: PASS.

## Task 5: Full Verification

**Files:**
- No new files expected.

- [ ] **Step 1: Run focused tests**

Run:

```bash
bun test src/tui/util/session.test.ts src/tui/util/groups.test.ts src/core/session.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`

Expected: PASS.

- [ ] **Step 3: Run broader tests if focused verification passes**

Run: `bun test`

Expected: PASS, or report unrelated pre-existing failures with evidence.
