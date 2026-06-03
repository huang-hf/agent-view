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
  options: { limit?: number } = {}
): Session[] {
  const limit = options.limit ?? CURRENT_SESSIONS_LIMIT
  return [...sessions]
    .filter((session) => CURRENT_SESSION_STATUSES.has(session.status))
    .sort((a, b) => b.lastAccessed.getTime() - a.lastAccessed.getTime())
    .slice(0, limit)
}
