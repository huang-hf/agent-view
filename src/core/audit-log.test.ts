import { describe, expect, test } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { auditLog, formatAuditEntry } from "./audit-log"

describe("audit-log", () => {
  test("formatAuditEntry returns one JSON line that round-trips", () => {
    const line = formatAuditEntry({
      ts: "2026-10-22T00:00:00.000Z",
      event: "session.delete",
      pid: 1,
      id: "x",
      title: 'a"b',
    })
    expect(line.endsWith("\n")).toBe(true)
    expect(line.indexOf("\n")).toBe(line.length - 1)
    const parsed = JSON.parse(line)
    expect(parsed.title).toBe('a"b')
    expect(parsed.event).toBe("session.delete")
  })

  test("auditLog appends to an override path, creating the dir", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-test-"))
    const file = path.join(dir, "sub", "audit.log")
    try {
      auditLog("e1", { a: 1 }, file)
      auditLog("e2", { b: 2 }, file)
      const lines = fs.readFileSync(file, "utf-8").trim().split("\n")
      expect(lines).toHaveLength(2)
      expect(JSON.parse(lines[1]).event).toBe("e2")
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test("auditLog never throws", () => {
    expect(() => auditLog("e", {}, "/dev/null/impossible/audit.log")).not.toThrow()
  })
})
