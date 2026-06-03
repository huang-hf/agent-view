# Stable Current Sessions Design

## Goal

Make the TUI `Current` group behave like a stable working set instead of a live `lastAccessed` sort. Accessing or confirming a session should update its access time without causing visible row movement.

Users also need a way to remove a session from `Current` without deleting, stopping, or moving the session.

## Problem

The current implementation derives `Current` directly from all sessions sorted by `lastAccessed` descending. Every attach, quick confirm, or future quick-send updates `lastAccessed`, which can reorder the group while the user is navigating it.

That makes the list feel unstable: the selected row and nearby rows can shift after normal use.

## Model

`Current` becomes a persisted working set:

- Store an ordered list of session ids.
- The list order is stable.
- Updating `lastAccessed` does not reorder the list.
- New sessions can enter the list.
- Users can remove entries explicitly.

Use config persistence rather than the current TUI KV store. The existing `useKV` context is process-local and does not survive restart, while this design requires stable order across TUI restarts.

Add an optional config field:

```ts
currentSessionIds?: string[]
```

No database schema migration is needed.

## Membership Rules

`Current` displays sessions whose ids are in `currentSessionIds`, filtered against the current session table:

- Include only existing sessions.
- Include only `running`, `waiting`, or `idle`.
- Exclude `stopped` and `hibernated`.
- Preserve the order stored in `currentSessionIds`.
- Limit display and storage to 10 ids.

When a session is intentionally accessed from outside `Current`, add it to `Current` if it is not already present.

Access actions:

- Creating a session adds it to the top.
- Attaching a session from a real group adds it to the top if absent.
- Quick confirm from a real group adds it to the top if absent.
- Future quick send from a real group should add it to the top if absent.

If the session is already in `Current`, do not move it.

When adding a new id and the list would exceed 10 entries, remove entries from the tail.

## Remove From Current

Use `x` to remove a session from `Current`.

Rules:

- `x` works only when the selected row is a session row rendered inside `Current`.
- It removes the selected session id from `currentSessionIds`.
- It does not delete, stop, hibernate, rename, or move the session.
- Show a toast such as `Removed from Current`.
- Pressing `x` on the `Current` header or a real-group row should do nothing or show a light hint.

Removal is not a permanent blocklist. If the user later intentionally accesses the session from its real group, the session can re-enter `Current`.

## Stop, Hibernate, Delete

Stopped, hibernated, and deleted sessions should not remain in the stored working set.

Clean `currentSessionIds` when rendering or refreshing the working set:

- Drop ids that no longer match an existing session.
- Drop ids whose status is `stopped` or `hibernated`.
- Keep order for remaining ids.

This prevents old inactive work from reappearing unexpectedly after restart.

## Ordering

Order changes only in these cases:

- New id is added to the top.
- User removes an id with `x`.
- Cleanup removes invalid or inactive ids.
- Tail is trimmed after exceeding 10 ids.

Order does not change when:

- `lastAccessed` changes.
- The user attaches a session already in `Current`.
- The user quick-confirms a session already in `Current`.
- Background status refresh runs.
- Preview polling captures output.

## UI Behavior

`Current` remains a virtual group at the top of the TUI home list.

Existing behavior remains:

- `Enter` attaches sessions.
- `h` / left arrow collapse.
- `l` / right arrow expand or attach.
- Real group number shortcuts are not affected.
- Group management actions do not operate on the `Current` header.

New behavior:

- `x` on a Current session removes it from `Current`.
- `x` on non-Current rows is ignored or lightly explained.

## Error Handling

- If config save fails when adding or removing a Current id, show an error toast and keep the UI consistent with the persisted config.
- If a session disappears between selection and `x`, clean the id list and refresh.
- If the config contains malformed `currentSessionIds`, treat it as empty or filter to string ids.

## Testing

Unit tests should cover:

- Stable ordering by stored ids, not `lastAccessed`.
- Existing ids do not move when added again.
- New ids are inserted at the top.
- Tail trimming at 10 ids.
- `stopped`, `hibernated`, and missing sessions are removed.
- `x` removal removes only from the Current working set.

Manual verification:

- Put several sessions in Current.
- Attach one from Current and verify its row does not jump.
- Attach a session from a real group and verify it enters Current at the top.
- Press `x` on a Current session and verify it disappears from Current but remains in its real group.
- Restart TUI and verify Current order persists.
