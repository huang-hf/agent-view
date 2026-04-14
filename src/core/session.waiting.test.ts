import { describe, expect, test } from "bun:test"
import { reconcileCodexWaitingCandidate, stabilizeWaitingTransition } from "./session"

describe("stabilizeWaitingTransition", () => {
  test("enters waiting immediately", () => {
    const result = stabilizeWaitingTransition("running", "waiting", 0)
    expect(result.next).toBe("waiting")
    expect(result.exitPolls).toBe(0)
  })

  test("debounces waiting exit by default", () => {
    const first = stabilizeWaitingTransition("waiting", "running", 0)
    expect(first.next).toBe("waiting")
    expect(first.exitPolls).toBe(1)

    const second = stabilizeWaitingTransition("waiting", "running", first.exitPolls)
    expect(second.next).toBe("running")
    expect(second.exitPolls).toBe(0)
  })
})

describe("reconcileCodexWaitingCandidate", () => {
  test("keeps waiting during sticky window after brief disappearance", () => {
    const now = 10000
    const result = reconcileCodexWaitingCandidate("waiting", "running", now - 500, 0, now)
    expect(result.candidate).toBe("waiting")
    expect(result.lastSeenAt).toBe(now - 500)
  })

  test("promotes waiting candidate and refreshes seen timestamp", () => {
    const now = 20000
    const result = reconcileCodexWaitingCandidate("running", "waiting", 0, 0, now)
    expect(result.candidate).toBe("waiting")
    expect(result.lastSeenAt).toBe(now)
  })

  test("suppresses waiting during post-confirm ignore window", () => {
    const now = 30000
    const result = reconcileCodexWaitingCandidate("running", "waiting", now - 100, now + 1000, now)
    expect(result.candidate).toBe("running")
    expect(result.lastSeenAt).toBe(now - 100)
  })
})
