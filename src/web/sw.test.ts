import { describe, expect, test } from "bun:test"
import { getServiceWorkerScript } from "./sw"

describe("web service worker script", () => {
  test("includes notification click handler", () => {
    const script = getServiceWorkerScript()
    expect(script.includes("notificationclick")).toBe(true)
  })

  test("supports show test message action", () => {
    const script = getServiceWorkerScript()
    expect(script.includes("clients.openWindow")).toBe(true)
  })
})
