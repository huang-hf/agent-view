import { describe, expect, test } from "bun:test"
import {
  deriveRemoteSessionStatus,
  stabilizeRunningTransition,
  stabilizeRemoteStoppedTransition,
  stabilizeRemoteWaitingTransition
} from "./session"
import type { ToolStatus } from "./tmux"

function makeToolStatus(overrides: Partial<ToolStatus> = {}): ToolStatus {
  return {
    isActive: false,
    isWaiting: false,
    isBusy: false,
    hasError: false,
    hasExited: false,
    ...overrides
  }
}

describe("deriveRemoteSessionStatus", () => {
  test("maps waiting first", () => {
    const status = makeToolStatus({ isWaiting: true })
    expect(deriveRemoteSessionStatus(status)).toBe("waiting")
  })

  test("maps Claude exited to idle", () => {
    const status = makeToolStatus({ hasExited: true })
    expect(deriveRemoteSessionStatus(status)).toBe("idle")
  })

  test("maps non-Claude exited to idle", () => {
    const status = makeToolStatus({ hasExited: true })
    expect(deriveRemoteSessionStatus(status)).toBe("idle")
  })
})

describe("stabilizeRemoteWaitingTransition", () => {
  test("exits waiting on first non-waiting poll", () => {
    const result = stabilizeRemoteWaitingTransition("waiting", "idle", 0)
    expect(result.next).toBe("idle")
    expect(result.polls).toBe(0)
  })

  test("resets counter when back to waiting", () => {
    const result = stabilizeRemoteWaitingTransition("running", "waiting", 1)
    expect(result.next).toBe("waiting")
    expect(result.polls).toBe(0)
  })
})

describe("stabilizeRemoteStoppedTransition", () => {
  test("keeps previous status during stop grace window", () => {
    const result = stabilizeRemoteStoppedTransition("waiting", "stopped", 0)
    expect(result.next).toBe("waiting")
    expect(result.polls).toBe(1)
  })

  test("marks stopped after consecutive stopped polls", () => {
    const result = stabilizeRemoteStoppedTransition("running", "stopped", 2)
    expect(result.next).toBe("stopped")
    expect(result.polls).toBe(0)
  })

  test("clears stop counter when candidate recovers", () => {
    const result = stabilizeRemoteStoppedTransition("running", "running", 2)
    expect(result.next).toBe("running")
    expect(result.polls).toBe(0)
  })
})

describe("stabilizeRunningTransition", () => {
  test("keeps running on first transient idle poll", () => {
    const result = stabilizeRunningTransition("running", "idle", 0, 3)
    expect(result.next).toBe("running")
    expect(result.polls).toBe(1)
  })

  test("exits running after grace polls", () => {
    const result = stabilizeRunningTransition("running", "idle", 2, 3)
    expect(result.next).toBe("idle")
    expect(result.polls).toBe(0)
  })

  test("resets counter when back to running", () => {
    const result = stabilizeRunningTransition("running", "running", 2, 3)
    expect(result.next).toBe("running")
    expect(result.polls).toBe(0)
  })

  test("does not delay transitions to waiting", () => {
    const result = stabilizeRunningTransition("running", "waiting", 1, 3)
    expect(result.next).toBe("waiting")
    expect(result.polls).toBe(0)
  })
})
