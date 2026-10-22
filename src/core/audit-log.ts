/**
 * Append-only audit log for destructive actions.
 * Lives next to state.db in ~/.agent-orchestrator/audit.log
 */

import * as fs from "fs"
import * as os from "os"
import * as path from "path"

export type DeleteSource = "tui" | "cli" | "unknown"

export interface AuditEntry {
  ts: string
  event: string
  pid: number
  [key: string]: unknown
}

export function getAuditLogPath(): string {
  return path.join(os.homedir(), ".agent-orchestrator", "audit.log")
}

export function formatAuditEntry(entry: AuditEntry): string {
  return JSON.stringify(entry) + "\n"
}

/** Append an entry to the audit log. Never throws. */
export function auditLog(event: string, data: Record<string, unknown>, filePath?: string): void {
  try {
    const target = filePath ?? getAuditLogPath()
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.appendFileSync(
      target,
      formatAuditEntry({ ts: new Date().toISOString(), event, pid: process.pid, ...data }),
    )
  } catch {
    // auditing must never break the action being audited
  }
}
