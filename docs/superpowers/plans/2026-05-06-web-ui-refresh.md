# Web UI Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the mobile-first web UI to a warm light `cc-web`-inspired workbench while preserving the existing single-page session workflow and backend behavior.

**Architecture:** Keep the current inline HTML/CSS/JS web app in `src/web/ui.html`, but reorganize the DOM into a lighter header, a continuous session workspace, and a drawer-like session switcher. Add a focused HTML-render smoke test to lock in the new landmarks and action hierarchy without introducing browser automation.

**Tech Stack:** Bun, TypeScript, inline HTML/CSS/JS, `bun:test`

---

## File Structure

- Modify: `src/web/ui.html`
  - Rework page structure, warm theme variables, action hierarchy, drawer styling, and lightweight client-side rendering labels.
- Create: `src/web/ui.test.ts`
  - Add HTML smoke tests around `renderWebAppHtml()` so the new landmarks and copied interaction priorities are locked in.
- Modify: `docs/superpowers/plans/2026-05-06-web-ui-refresh.md`
  - Track execution progress by checking off steps as they are completed.

### Task 1: Add UI Markup Regression Tests

**Files:**
- Create: `src/web/ui.test.ts`
- Modify: `src/web/ui.ts`
- Test: `src/web/ui.test.ts`

- [x] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test"
import { renderWebAppHtml } from "./ui"

describe("web ui html", () => {
  test("renders the warm workbench shell and simplified top bar labels", () => {
    const html = renderWebAppHtml()

    expect(html.includes("Agent View")).toBe(true)
    expect(html.includes("Current session")).toBe(true)
    expect(html.includes("Open sessions")).toBe(true)
    expect(html.includes("Notifications")).toBe(true)
    expect(html.includes("Enable Notifications")).toBe(false)
    expect(html.includes("Test Notification")).toBe(false)
  })

  test("keeps send as the primary action and secondary session controls present", () => {
    const html = renderWebAppHtml()

    expect(html.includes('id="btn-send" class="primary"')).toBe(true)
    expect(html.includes("Quick Confirm")).toBe(true)
    expect(html.includes("Interrupt")).toBe(true)
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `bun test src/web/ui.test.ts`
Expected: FAIL because the new labels and layout markers are not in `src/web/ui.html` yet.

- [x] **Step 3: Write minimal implementation support**

No production logic changes are required in `src/web/ui.ts`; confirm the existing `renderWebAppHtml()` export is sufficient for the test to import.

- [x] **Step 4: Run test to verify it still fails for the right reason**

Run: `bun test src/web/ui.test.ts`
Expected: FAIL only on missing HTML content, not on import/runtime errors.

- [ ] **Step 5: Commit**

```bash
git add src/web/ui.test.ts
git commit -m "test: add web ui refresh coverage"
```

### Task 2: Reshape the Mobile Header and Main Workspace

**Files:**
- Modify: `src/web/ui.html`
- Test: `src/web/ui.test.ts`

- [x] **Step 1: Write the failing test for the new workspace copy**

Extend `src/web/ui.test.ts` with an assertion that the page exposes the simplified workbench sections and drawer entry copy before changing production HTML.

```ts
test("exposes the workbench summary and drawer-oriented session navigation copy", () => {
  const html = renderWebAppHtml()

  expect(html.includes("Session workspace")).toBe(true)
  expect(html.includes("Session activity")).toBe(true)
  expect(html.includes("Open sessions")).toBe(true)
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `bun test src/web/ui.test.ts`
Expected: FAIL because the page still uses the old mobile card copy.

- [x] **Step 3: Implement the minimal structural HTML update**

Update `src/web/ui.html` to:

- replace the current top bar with a light header containing menu trigger, current session title, and compact waiting/status summary
- convert the main card into a continuous workspace with summary strip, transcript area, and input/action zone
- preserve existing element IDs used by the script whenever possible
- move notification actions out of the top header into the drawer/settings block

- [x] **Step 4: Run test to verify it passes**

Run: `bun test src/web/ui.test.ts`
Expected: PASS for the new top-level copy and section markers.

- [ ] **Step 5: Commit**

```bash
git add src/web/ui.html src/web/ui.test.ts
git commit -m "feat: reshape web ui workspace layout"
```

### Task 3: Apply the Warm Light Theme and Drawer Styling

**Files:**
- Modify: `src/web/ui.html`
- Test: `src/web/ui.test.ts`

- [x] **Step 1: Write the failing test for warm-theme and drawer landmarks**

Add a regression test that checks for warm-theme class names or copy introduced specifically for the refreshed drawer and settings grouping.

```ts
test("includes drawer utilities for notifications and session navigation", () => {
  const html = renderWebAppHtml()

  expect(html.includes("drawer-meta")).toBe(true)
  expect(html.includes("Notification settings")).toBe(true)
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `bun test src/web/ui.test.ts`
Expected: FAIL because the warm drawer markup does not exist yet.

- [x] **Step 3: Implement the minimal styling and drawer changes**

In `src/web/ui.html`:

- replace dark glass CSS variables with warm light palette variables
- reduce glow/gradient intensity and move toward soft borders and subtle shadows
- style the switcher modal as a drawer-like panel
- add a notification/settings area inside the drawer
- keep all existing session selection and acknowledge behavior wired to current IDs/data attributes

- [x] **Step 4: Run test to verify it passes**

Run: `bun test src/web/ui.test.ts`
Expected: PASS for new drawer utility markup while earlier tests remain green.

- [ ] **Step 5: Commit**

```bash
git add src/web/ui.html src/web/ui.test.ts
git commit -m "feat: apply warm mobile web ui theme"
```

### Task 4: Verify the Full Web UI Refresh

**Files:**
- Modify: `docs/superpowers/plans/2026-05-06-web-ui-refresh.md`
- Test: `src/web/ui.test.ts`

- [x] **Step 1: Run focused web UI tests**

Run: `bun test src/web/ui.test.ts src/web/sw.test.ts`
Expected: PASS with all web UI and service worker tests green.

- [x] **Step 2: Run broader project verification**

Run: `bun test`
Expected: PASS or, if unrelated failures already exist, document the exact failures and confirm the new web UI coverage still passes.

Result: `bun test` failed outside the web UI scope in existing CLI argument coverage (`src/cli/args.test.ts`) around removed `restartWeb`/`daemon`/`acknowledge` behavior. The new web UI coverage and existing `src/web/sw.test.ts` both passed in the same run.

- [ ] **Step 3: Run static verification**

Run: `bun run typecheck`
Expected: PASS with no new type errors introduced by the UI refresh.

Result: `bun run typecheck` failed because the current branch already contains broad pre-existing type errors in CLI/core/TUI files unrelated to `src/web/ui.html` or `src/web/ui.test.ts`.

- [x] **Step 4: Mark completed plan steps**

Update this file so every completed checkbox reflects actual execution state.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-05-06-web-ui-refresh.md src/web/ui.test.ts src/web/ui.html
git commit -m "chore: verify web ui refresh"
```
