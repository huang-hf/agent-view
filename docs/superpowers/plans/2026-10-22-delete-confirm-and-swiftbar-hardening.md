# Delete Confirmation + SwiftBar Hardening Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox (`- [ ]`) syntax. One commit per task.

**Goal:** Fix five defects found while investigating a SwiftBar incident on 2026-10-22: sessions can be deleted by a single stray key with no trace, the SwiftBar plugin masks failures as an empty `◌` title, `config.json` writes can be read half-written, and the monitor's heartbeat row is lost after sleep.

**Architecture:** Small, independent fixes in existing modules plus one new tiny module (`src/core/audit-log.ts`). No schema migrations, no new config fields.

**Tech Stack:** Bun, TypeScript, Solid/OpenTUI, bun:sqlite, Python 3 (SwiftBar plugin), bun test.

**Design (approved in chat):** see the "设计(5 项)" message in the session; summarized per task below.

## Global Constraints

- `bun run build` after every code change (project rule).
- Check a file's existing imports before using a symbol; add missing imports at the top.
- Runtime log files live in `~/.agent-orchestrator/` (same dir as `state.db`).
- No new `AppConfig` fields.
- Do NOT run `bun run install-local`, `install.sh`, `uninstall.sh`, `av monitor install/uninstall`, or `launchctl` — those touch the user's live machine. Do NOT copy files into `~/SwiftBarPlugins/` — the main session does that after review.
- Known pre-existing failures: 8 tests in `src/cli/args.test.ts` (`--web`/`--all`/`--acknowledge`) fail on `main` already. Do not fix them; do not count them as regressions.
- Commit messages end with a blank line + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Heartbeat survives sleep/wake

**Problem:** `Storage.heartbeat()` (`src/core/storage.ts:426-430`) is a plain `UPDATE ... WHERE pid = ?`. After the Mac sleeps >15s, the first refresh tick runs `cleanDeadInstances(15)` (`src/core/session.ts:281-283`) before the 5s heartbeat fires, deleting the process's own row. The UPDATE then matches nothing forever, so the `heartbeats` table stays empty and primary election (`electPrimary`) degrades (every instance thinks it is primary).

**Files:**
- Modify: `src/core/storage.ts` (`heartbeat()`)
- Modify: `src/core/session.ts` (`startRefreshLoop` tick order)
- Test: `src/core/storage.test.ts`

- [ ] **Step 1: Failing test.** In `src/core/storage.test.ts`, following that file's existing setup pattern for a temp DB, add a test: `registerInstance(false)`, then delete the row directly (`DELETE FROM heartbeats`) or via `cleanDeadInstances(-1000)`, then call `heartbeat()`, then assert a row for the storage's pid exists with `heartbeat` ≈ now. Also a test that `heartbeat()` on an existing row preserves `started` and `is_primary` (set `is_primary=1` via `electPrimary`, call `heartbeat()`, assert still 1 and `started` unchanged). Run `bun test src/core/storage.test.ts` → the first test FAILS.
- [ ] **Step 2: Implement.** Replace `heartbeat()` body with an upsert:
  ```ts
  heartbeat(): void {
    const now = Math.floor(Date.now() / 1000)
    this.db.prepare(`
      INSERT INTO heartbeats (pid, started, heartbeat, is_primary)
      VALUES (?, ?, ?, 0)
      ON CONFLICT(pid) DO UPDATE SET heartbeat = excluded.heartbeat
    `).run(this.pid, now, now)
  }
  ```
- [ ] **Step 3: Tick order.** In `SessionManager.startRefreshLoop` (`src/core/session.ts:281`), make each refresh tick call `storage.heartbeat()` FIRST, then `cleanDeadInstances(15)`, then `electPrimary(15)`. Keep the separate 5s heartbeat interval as is.
- [ ] **Step 4:** `bun test src/core/storage.test.ts src/core/session.test.ts` → PASS; `bun run build`.
- [ ] **Step 5: Commit** `fix(storage): upsert heartbeat so instances recover after sleep`.

---

### Task 2: Atomic `saveConfig`

**Problem:** `saveConfig` (`src/core/config.ts`) uses `fs.writeFile(CONFIG_PATH, ...)`, which truncates then writes. The SwiftBar plugin polls `config.json` every 3s and can read a truncated file → its `currentSessionIds` parse fails → empty Current → `◌` title.

**Files:**
- Modify: `src/core/config.ts` (`saveConfig`)
- Test: `src/core/config.test.ts`

- [ ] **Step 1: Failing/guard test.** Read `src/core/config.test.ts` first to see how it isolates the config path (env/HOME override or injectable path). If saveConfig's path is not injectable in tests, add a small exported helper `writeFileAtomic(filePath: string, content: string): Promise<void>` in `config.ts` and test THAT: writes content, leaves no `*.tmp-*` siblings in the dir, overwrites an existing file. Run → FAIL (not defined).
- [ ] **Step 2: Implement.**
  ```ts
  export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
    const tmp = `${filePath}.tmp-${process.pid}`
    await fs.writeFile(tmp, content, "utf-8")
    await fs.rename(tmp, filePath)
  }
  ```
  and in `saveConfig` replace the `fs.writeFile(CONFIG_PATH, content, "utf-8")` with `await writeFileAtomic(CONFIG_PATH, content)`. (`fs` here is `fs/promises`, already imported.)
- [ ] **Step 3:** `bun test src/core/config.test.ts` → PASS; `bun run build`.
- [ ] **Step 4: Commit** `fix(config): write config.json atomically`.

---

### Task 3: Session deletion audit log

**Problem:** Sessions can disappear with no record of when/how (incident: `my-mint-home` vanished between 2026-10-19 and 2026-10-22).

**Files:**
- Create: `src/core/audit-log.ts`, `src/core/audit-log.test.ts`
- Modify: `src/core/session.ts` (`delete()` at ~`:659`)
- Modify: `src/tui/context/sync.tsx` (`session.delete` → pass `source: "tui"`)
- Modify: `src/cli/commands.ts` (`cmdDelete` → pass `source: "cli"`, ~`:263`)

**Interfaces:**
- `export type DeleteSource = "tui" | "cli" | "unknown"`
- `export function formatAuditEntry(entry: AuditEntry): string` — pure, returns one JSON line ending in `\n`
- `export function auditLog(event: string, data: Record<string, unknown>): void` — appends `formatAuditEntry({ ts: new Date().toISOString(), event, pid: process.pid, ...data })` to `~/.agent-orchestrator/audit.log`; creates the dir if missing; NEVER throws (wrap in try/catch).
- `SessionManager.delete(sessionId, options?: { deleteWorktree?: boolean; source?: DeleteSource })`

- [ ] **Step 1: Failing test** (`audit-log.test.ts`): `formatAuditEntry({ts:"2026-10-22T00:00:00.000Z", event:"session.delete", pid:1, id:"x", title:"a\"b"})` returns valid JSON + `\n`, `JSON.parse` round-trips (title with quote preserved). Run → FAIL.
- [ ] **Step 2: Implement** `audit-log.ts` (use `fs.appendFileSync`; path via `os.homedir()` + `.agent-orchestrator/audit.log`; optionally accept an override path param on `auditLog` for tests).
- [ ] **Step 3: Wire into `delete()`.** At the start of `SessionManager.delete`, after loading `session`, call:
  ```ts
  auditLog("session.delete", {
    id: sessionId,
    title: session?.title,
    tool: session?.tool,
    status: session?.status,
    projectPath: session?.projectPath,
    deleteWorktree: !!options?.deleteWorktree,
    source: options?.source ?? "unknown",
  })
  ```
  Pass `source: "tui"` from `sync.tsx`'s `session.delete` (merge into the options object it forwards) and `source: "cli"` from `cmdDelete`. Update `sync.tsx`'s `delete(id, options?)` type to accept the field only if needed — simplest is sync always adds `source: "tui"` itself.
- [ ] **Step 4:** `bun test src/core/audit-log.test.ts src/core/session.test.ts` → PASS (existing session.test spies on delete paths — keep them passing); `bun run build`.
- [ ] **Step 5: Commit** `feat(session): append session deletions to audit.log`.

---

### Task 4: Confirm every session delete; ctrl+d no longer deletes

**Problem:** For sessions without a worktree, `d` deletes immediately with no confirmation (`src/tui/routes/home.tsx:509-511`, `src/tui/component/dialog-sessions.tsx:~133`). The handler at `home.tsx:643` checks only `evt.name === "d"`, so `ctrl+d` (a reflexive "exit shell" key) also deletes. `keybind.tsx:31` also lists `ctrl+d`.

**Files:**
- Modify: `src/tui/routes/home.tsx` (`handleDelete`, the `d` key handler ~`:643`)
- Modify: `src/tui/component/dialog-sessions.tsx` (delete flow ~`:116-134`; and its `d` key handler if it has one — check)
- Modify: `src/tui/context/keybind.tsx:31` (`delete: ["d"]`)

- [ ] **Step 1: home.tsx `handleDelete`.** For the no-worktree branch, show a confirmation using the same `DialogSelect` pattern already used in the worktree branch:
  - title `Delete "${session.title}"?`
  - options `[{ title: "Delete session", value: "delete-session" }, { title: "Cancel", value: "cancel" }]`
  - on `cancel` → `dialog.clear()` and return; on `delete-session` → existing delete + toast.
  Also add a `{ title: "Cancel", value: "cancel" }` option to the existing worktree dialog and handle it (clear, return).
- [ ] **Step 2: Key guard.** Change `if (evt.name === "d")` at `home.tsx:~643` to `if (evt.name === "d" && !evt.ctrl && !evt.meta)`. Check the same handler style in `dialog-sessions.tsx` and `tasks.tsx:227` (tasks: apply the same guard — task deletion shouldn't fire on ctrl+d either).
- [ ] **Step 3: dialog-sessions.tsx.** Same confirmation for the no-worktree path (use `dialog.push`/`dialog.pop` as that file already does), plus Cancel on the worktree dialog.
- [ ] **Step 4: keybind.tsx.** `delete: ["d"]`.
- [ ] **Step 5:** Verify imports (`DialogSelect` is already imported in both files — confirm). `bun run build`. Run `bun test src/tui 2>/dev/null` if tui tests exist, else skip. Grep to confirm no remaining `ctrl+d` delete binding.
- [ ] **Step 6: Commit** `fix(tui): confirm every session delete; ctrl+d no longer deletes`.

---

### Task 5: SwiftBar plugin — surface failures, log every run

**Problem:** `tools/swiftbar/agent-view.3s.py` treats `av` failure with empty stdout as `[]` (`json.loads(out.stdout or "[]")`) and a config parse error as empty Current, both rendering a bare `◌` instead of `⚠️ av`. There is no record of what the plugin output, so incidents can't be diagnosed.

**Files:**
- Modify: `tools/swiftbar/agent-view.3s.py`
- Create: `tools/swiftbar/test_plugin.py` (stdlib `unittest`, no deps)

- [ ] **Step 1: av failures.** In `load_sessions`, if `returncode != 0` or `stdout.strip() == ""`, raise an exception carrying `f"av exit {rc}: {stderr first 3 lines}"`. `main()`'s existing `except` path prints `⚠️ av` — extend it to print the error text as a dropdown line (sanitize `|` → `¦`).
- [ ] **Step 2: config reads.** `load_current_ids`: if the file is missing → `[]` (legit: no Current). If it exists but `json.load` fails → retry up to 3 times with `time.sleep(0.1)`; if still failing, raise → `⚠️ av` with "config.json unreadable".
- [ ] **Step 3: run log.** Append one line per run to `~/.agent-orchestrator/swiftbar.log`: `ISO-time  ok|error  w=.. r=.. i=.. b=.. cur=N  [error text]`. After appending, if the file exceeds 1000 lines, rewrite it keeping the last 500. Logging must never raise (try/except pass). Allow overriding the log path and the `av` path via env vars `AV_SWIFTBAR_LOG` / `AV_SWIFTBAR_AV` (for tests); also `AV_SWIFTBAR_CONFIG` for the config path.
- [ ] **Step 4: Tests** (`tools/swiftbar/test_plugin.py`, run with `python3 -m unittest tools/swiftbar/test_plugin.py`): run the plugin as a subprocess with env overrides pointing at temp files and a fake `av` shell script:
  - fake av exits 1 with stderr "boom" → stdout first line starts with `⚠️ av` and contains "boom" somewhere; log line contains `error`.
  - fake av prints `[]`-free empty stdout with exit 0 → `⚠️ av`.
  - fake av prints a valid JSON list with one idle session whose id is in a temp config's `currentSessionIds` → first line `○1`; log line contains `ok`.
  - config.json containing invalid JSON → `⚠️ av` mentioning config.
  - idle + note → `⧗1` (existing blocked behavior still works).
- [ ] **Step 5:** `python3 -m py_compile tools/swiftbar/agent-view.3s.py` and the unittest → PASS. Remove any `__pycache__` created under `tools/swiftbar/`. Do NOT copy to `~/SwiftBarPlugins/`.
- [ ] **Step 6: Commit** `fix(swiftbar): show ⚠️ on av/config failures and log each run`.

---

## Groups

- Group 1: Task 1, 2, 3 (core)
- Group 2: Task 4, 5 (TUI + plugin)
