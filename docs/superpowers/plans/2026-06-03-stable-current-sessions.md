# Stable Current Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the TUI `Current` group a stable persisted working set with `x` removal, so access time changes do not move rows.

**Architecture:** Store an ordered `currentSessionIds` array in config, derive displayed Current sessions from that order, and mutate the array only on explicit add/remove/cleanup. Keep `lastAccessed` updates intact but decouple them from Current ordering.

**Tech Stack:** Bun, TypeScript, Solid JSX, OpenTUI, `bun:test`.

---

## File Structure

- Modify `src/core/config.ts`: add `currentSessionIds?: string[]` to `AppConfig`; preserve it across load/save.
- Modify `src/core/config.test.ts`: verify config accepts `currentSessionIds`.
- Modify `src/tui/util/session.ts`: replace live `lastAccessed` Current selection with stable working-set helpers.
- Modify `src/tui/util/session.test.ts`: cover stable order, add-to-top, no movement for existing ids, tail trimming, inactive cleanup.
- Modify `src/tui/routes/home.tsx`: read/write Current ids from config, add sessions on access, remove with `x`, and render Current from stable ids.
- Modify `src/tui/component/dialog-help.tsx`: document `x` remove from Current.

## Task 1: Config Field

**Files:**
- Modify: `src/core/config.ts`
- Modify: `src/core/config.test.ts`

- [ ] **Step 1: Write failing test**

Add a config structure test:

```ts
test("AppConfig allows current session ids", () => {
  const config: AppConfig = { currentSessionIds: ["s1", "s2"] }
  expect(config.currentSessionIds).toEqual(["s1", "s2"])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/core/config.test.ts`

Expected: FAIL because `currentSessionIds` is not in `AppConfig`.

- [ ] **Step 3: Add field**

Add:

```ts
currentSessionIds?: string[]
```

to `AppConfig`.

- [ ] **Step 4: Run test**

Run: `bun test src/core/config.test.ts`

Expected: PASS.

## Task 2: Stable Current Helpers

**Files:**
- Modify: `src/tui/util/session.ts`
- Modify: `src/tui/util/session.test.ts`

- [ ] **Step 1: Write failing tests**

Replace or extend `getCurrentSessions` tests to cover:

- `getCurrentSessions(sessions, { ids })` preserves `ids` order, not `lastAccessed`.
- Existing ids do not move when added again.
- New ids are inserted at the top.
- Stored ids are trimmed to 10.
- Missing, `stopped`, and `hibernated` sessions are cleaned.

- [ ] **Step 2: Run test to verify failure**

Run: `bun test src/tui/util/session.test.ts`

Expected: FAIL because helper APIs do not exist yet.

- [ ] **Step 3: Implement helpers**

Implement:

```ts
export function getCurrentSessions(
  sessions: Session[],
  options: { ids?: string[]; limit?: number } = {}
): Session[]

export function normalizeCurrentSessionIds(
  ids: string[],
  sessions: Session[],
  options: { limit?: number } = {}
): string[]

export function addCurrentSessionId(
  ids: string[],
  sessionId: string,
  options: { limit?: number } = {}
): string[]

export function removeCurrentSessionId(ids: string[], sessionId: string): string[]
```

Rules:

- `getCurrentSessions` with `ids` uses normalized id order.
- `getCurrentSessions` without `ids` can keep existing `lastAccessed` fallback for first-run behavior.
- `addCurrentSessionId` returns unchanged ids when id already exists.
- `addCurrentSessionId` prepends missing ids and trims tail.
- `normalizeCurrentSessionIds` removes missing/inactive ids and trims tail.

- [ ] **Step 4: Run test**

Run: `bun test src/tui/util/session.test.ts`

Expected: PASS.

## Task 3: Home Integration And `x` Removal

**Files:**
- Modify: `src/tui/routes/home.tsx`
- Modify: `src/tui/component/dialog-help.tsx`

- [ ] **Step 1: Wire config-backed ids**

Import `getConfig` / `saveConfig` or create small local helpers in Home:

- Read `currentSessionIds` from config.
- Normalize against `allSessions`.
- Persist when normalization changes.
- Render `Current` from `getCurrentSessions(allSessions(), { ids })`.

- [ ] **Step 2: Add-on-access behavior**

When the user intentionally accesses a session from a real group:

- attach from real group
- quick confirm from real group

add it to the Current ids if absent.

If the selected row is already a Current row, do not move it.

- [ ] **Step 3: Add `x` key handling**

When selected item is a Current session:

- Remove id from config-backed Current ids.
- Show `Removed from Current`.
- Refresh derived Current list.

When selected item is not a Current session:

- Ignore or show a short hint.

- [ ] **Step 4: Update help dialog**

Add `x` under Sessions:

```ts
{ key: "x", description: "Remove from Current" }
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
bun test src/tui/util/session.test.ts src/tui/util/groups.test.ts src/core/config.test.ts
```

Expected: PASS.

## Task 4: Verification

**Files:**
- No new files expected.

- [ ] **Step 1: Run Current focused tests**

Run:

```bash
bun test src/tui/util/session.test.ts src/tui/util/groups.test.ts src/core/config.test.ts src/core/session.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`

Expected: May fail on existing project-wide type issues. Report exact result.

- [ ] **Step 3: Run full tests**

Run: `bun test`

Expected: May fail on existing `src/cli/args.test.ts` issues. Report exact result.
