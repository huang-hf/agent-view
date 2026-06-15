import { describe, expect, test } from "bun:test"
import { HOME_PREVIEW_DEBOUNCE_MS, HOME_PREVIEW_POLL_MS, startHomePreviewLoop } from "./preview"

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe("startHomePreviewLoop", () => {
  test("waits for debounce before first run", async () => {
    let calls = 0
    const stop = startHomePreviewLoop(() => {
      calls += 1
    })

    await sleep(HOME_PREVIEW_DEBOUNCE_MS - 30)
    expect(calls).toBe(0)

    await sleep(60)
    expect(calls).toBe(1)
    stop()
  })

  test("continues polling after the first run", async () => {
    let calls = 0
    const stop = startHomePreviewLoop(() => {
      calls += 1
    })

    await sleep(HOME_PREVIEW_DEBOUNCE_MS + HOME_PREVIEW_POLL_MS + 80)
    expect(calls).toBeGreaterThanOrEqual(2)
    stop()
  })

  test("stops future runs after cleanup", async () => {
    let calls = 0
    const stop = startHomePreviewLoop(() => {
      calls += 1
    })

    await sleep(HOME_PREVIEW_DEBOUNCE_MS + 40)
    stop()
    const callsAfterStop = calls

    await sleep(HOME_PREVIEW_POLL_MS + 80)
    expect(calls).toBe(callsAfterStop)
  })
})
