/**
 * Session utilities
 */

import type { Session } from "@/core/types"

export const CURRENT_SESSIONS_LIMIT = 10
export const CURRENT_SESSION_STATUSES = new Set(["running", "waiting", "idle"])

/**
 * Sort sessions by creation time (newest first).
 * This provides a stable sort order that doesn't change when session
 * status changes or when sessions are accessed.
 */
export function sortSessionsByCreatedAt(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => {
    return b.createdAt.getTime() - a.createdAt.getTime()
  })
}

/**
 * Select the sessions shown in the virtual Current group.
 */
export function getCurrentSessions(
  sessions: Session[],
  options: { ids?: string[]; limit?: number } = {}
): Session[] {
  const limit = options.limit ?? CURRENT_SESSIONS_LIMIT
  if (options.ids) {
    const sessionsById = new Map(sessions.map((session) => [session.id, session]))
    return normalizeCurrentSessionIds(options.ids, sessions, { limit })
      .map((id) => sessionsById.get(id))
      .filter((session): session is Session => !!session)
  }

  return [...sessions]
    .filter((session) => CURRENT_SESSION_STATUSES.has(session.status))
    .sort((a, b) => b.lastAccessed.getTime() - a.lastAccessed.getTime())
    .slice(0, limit)
}

export function normalizeCurrentSessionIds(
  ids: string[],
  sessions: Session[],
  options: { limit?: number } = {}
): string[] {
  const limit = options.limit ?? CURRENT_SESSIONS_LIMIT
  const sessionsById = new Map(sessions.map((session) => [session.id, session]))
  const result: string[] = []
  const seen = new Set<string>()

  for (const id of ids) {
    if (seen.has(id)) continue
    const session = sessionsById.get(id)
    if (!session) continue
    if (!CURRENT_SESSION_STATUSES.has(session.status)) continue
    seen.add(id)
    result.push(id)
    if (result.length >= limit) break
  }

  return result
}

export function addCurrentSessionId(
  ids: string[],
  sessionId: string,
  options: { limit?: number } = {}
): string[] {
  const limit = options.limit ?? CURRENT_SESSIONS_LIMIT
  if (ids.includes(sessionId)) return ids
  return [sessionId, ...ids].slice(0, limit)
}

export function removeCurrentSessionId(ids: string[], sessionId: string): string[] {
  return ids.filter((id) => id !== sessionId)
}

export function getCurrentSessionIdsAfterRefresh(
  ids: string[],
  sessions: Session[],
  options: { hasPersistedIds: boolean; limit?: number }
): string[] {
  if (options.hasPersistedIds) return ids
  if (ids.length > 0) return ids
  return getCurrentSessions(sessions, { limit: options.limit }).map((session) => session.id)
}
