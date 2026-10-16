import { test, expect } from "bun:test"
import { acquireLock } from "./monitor"
import * as fs from "fs"
import os from "os"
import path from "path"

function tmpFile(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "av-mon-")), "monitor.pid")
}

test("acquires when pidfile is missing", () => {
  const f = tmpFile()
  const res = acquireLock(f, () => true)
  expect(res.acquired).toBe(true)
  expect(fs.readFileSync(f, "utf8").trim()).toBe(String(process.pid))
})

test("refuses when a live monitor pid is present", () => {
  const f = tmpFile()
  fs.writeFileSync(f, "999999")
  const res = acquireLock(f, (pid) => pid === 999999) // pretend it is alive
  expect(res.acquired).toBe(false)
  expect(res.existingPid).toBe(999999)
})

test("acquires over a stale (dead) pidfile", () => {
  const f = tmpFile()
  fs.writeFileSync(f, "999999")
  const res = acquireLock(f, () => false) // dead
  expect(res.acquired).toBe(true)
  expect(fs.readFileSync(f, "utf8").trim()).toBe(String(process.pid))
})

test("treats a non-positive pid as stale", () => {
  const f = tmpFile()
  fs.writeFileSync(f, "0")
  const res = acquireLock(f, () => true)
  expect(res.acquired).toBe(true)
})
