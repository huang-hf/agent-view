# Current Sessions Design

## Goal

Add a `Current` area to the TUI home screen so users can quickly return to recently active sessions without changing their existing group organization.

`Current` should feel like a recent group, but it is a read-only virtual group. Sessions remain in their original groups and can appear in both `Current` and their real group.

## Non-Goals

- Do not add a Web UI version in this design.
- Do not create a real persisted group named `Current`.
- Do not add manual "remove from Current" state.
- Do not change the storage schema.
- Do not reorder sessions inside real groups.

## Current Group Semantics

The TUI home screen inserts a virtual `Current` group before all real groups.

The group contains up to 10 sessions selected from all local sessions:

- Include sessions with status `running`, `waiting`, or `idle`.
- Exclude sessions with status `stopped` or `hibernated`.
- Sort by `lastAccessed` descending.
- Take the first 10 sessions.
- Hide the group when no sessions match.

This means sessions leave `Current` automatically when they are stopped or hibernated, or when they fall out of the top 10 most recently accessed active sessions. There is no absolute time window, so leaving the app overnight does not empty `Current`.

## `lastAccessed` Definition

`lastAccessed` means the time when the user intentionally returned to, entered, or acted on a session.

It should update when:

- A session is created.
- The user attaches to a session from the TUI home screen, including from `Current`.
- The user attaches to a session from other TUI session navigation surfaces.
- A CLI attach operation targets the session.
- A quick confirm action is sent to a waiting session from the TUI home screen.
- A future quick send-message action targets the session.
- Resume, wake, or restart flows return the user to the session or explicitly act on it.

It should not update when:

- Background status refresh runs.
- The preview pane captures output.
- A session is merely rendered in the list.
- The keyboard cursor moves over a session.
- The session produces output in the background.
- The session status changes due to polling.

This keeps `Current` focused on user attention, not background activity.

## Interaction

`Current` behaves like a normal group for navigation:

- It appears above real groups.
- It is expanded by default.
- `j` / `k` and arrow navigation move through the group header and its sessions.
- `h` / left arrow collapses the `Current` group.
- `l` / right arrow expands `Current`; on a session row it attaches as usual.
- `Enter` on a `Current` session attaches to that real session.

`Current` does not participate in real group management:

- Number keys `1-9` continue to jump to real groups only. `Current` does not consume a group number.
- Group-only actions such as delete group and rename group should not operate on the `Current` header.
- Session actions on a session shown inside `Current` still operate on the real session: delete, restart, rename, move, hibernate, quick confirm, and duplicate.

Exiting `Current` is just normal navigation: collapse it or move selection into a real group. There is no separate exit command.

## Architecture

Add a small session utility, for example:

```ts
getCurrentSessions(sessions: Session[], options?: { limit?: number }): Session[]
```

The utility handles:

- Filtering by status.
- Sorting by `lastAccessed`.
- Applying the limit.

The TUI home route then composes the visible list by adding a virtual `Current` group before the output of the existing real-group flattening logic.

The current `GroupedItem` model should be extended or wrapped so the UI can distinguish:

- Real group headers.
- Virtual `Current` header.
- Real session rows that came from `Current`.
- Real session rows that came from real groups.

This distinction is needed so group management actions can ignore the `Current` header while session actions keep working normally.

## Error Handling

The virtual group should avoid introducing new error states:

- If there are no matching sessions, do not render `Current`.
- If a session listed in `Current` disappears before an action runs, reuse existing session-not-found behavior.
- If attach, quick confirm, restart, or other session actions fail, reuse existing toast error handling.

## Testing

Add focused tests for the session utility:

- Returns active sessions sorted by `lastAccessed` descending.
- Limits the result to 10 by default.
- Excludes `stopped` sessions.
- Excludes `hibernated` sessions.
- Keeps `running`, `waiting`, and `idle` sessions.

Add TUI utility or route-level tests where practical:

- `Current` is present when matching sessions exist.
- `Current` is hidden when no matching sessions exist.
- `Current` does not consume numeric group jump indexes.
- A session can appear in both `Current` and its real group.

Manual verification:

- Create or use more than 10 active sessions and verify only the 10 most recently accessed appear in `Current`.
- Attach to an older active session from its real group and verify it moves to the top of `Current`.
- Stop or hibernate a session and verify it disappears from `Current`.
- Leave the app idle and verify `Current` does not clear due to elapsed time alone.
