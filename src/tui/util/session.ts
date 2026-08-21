/**
 * Session utilities — the Current working set.
 *
 * Current is a purely human-curated set: a session joins when the user acts on
 * it (create / attach / confirm / shortcut) and leaves only when the user
 * removes it with `x` or the session is deleted. Membership does NOT depend on
 * status, so hibernated/stopped/offline sessions stay until explicitly removed.
 */

import type { Session } from "@/core/types"

export const CURRENT_SESSIONS_LIMIT = 10

/** Add a session to the front of the Current set. No-op if already present. */
export function addCurrentSessionId(
  ids: string[],
  sessionId: string,
  options: { limit?: number } = {}
): string[] {
  const limit = options.limit ?? CURRENT_SESSIONS_LIMIT
  if (ids.includes(sessionId)) return ids
  return [sessionId, ...ids].slice(0, limit)
}

/** Remove a session from the Current set. */
export function removeCurrentSessionId(ids: string[], sessionId: string): string[] {
  return ids.filter((id) => id !== sessionId)
}

/** Drop ids that no longer map to an existing session (deleted), and dedupe. */
export function pruneCurrentSessionIds(ids: string[], sessions: Session[]): string[] {
  const existing = new Set(sessions.map((s) => s.id))
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    if (seen.has(id) || !existing.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/** Resolve the Current ids to live session objects, in id order, skipping gone. */
export function selectCurrentSessions(ids: string[], sessions: Session[]): Session[] {
  const byId = new Map(sessions.map((s) => [s.id, s]))
  const seen = new Set<string>()
  const out: Session[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    const session = byId.get(id)
    if (!session) continue
    seen.add(id)
    out.push(session)
  }
  return out
}
