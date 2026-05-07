import { describe, expect, test } from "bun:test"
import { renderWebAppHtml } from "./ui"

describe("web ui html", () => {
  test("renders the warm workbench shell and simplified top bar labels", () => {
    const html = renderWebAppHtml()

    expect(html.includes("Agent View")).toBe(true)
    expect(html.includes("Current session")).toBe(true)
    expect(html.includes("Open sessions")).toBe(true)
    expect(html.includes("Notifications")).toBe(true)
    expect(html.includes("Enable Notifications")).toBe(false)
    expect(html.includes("Test Notification")).toBe(false)
  })

  test("keeps send as the primary action and secondary session controls present", () => {
    const html = renderWebAppHtml()

    expect(html.includes('id="btn-send" class="primary"')).toBe(true)
    expect(html.includes("Quick Confirm")).toBe(true)
    expect(html.includes("Interrupt")).toBe(true)
  })

  test("exposes the workbench summary and drawer-oriented session navigation copy", () => {
    const html = renderWebAppHtml()

    expect(html.includes("Session workspace")).toBe(true)
    expect(html.includes("Session activity")).toBe(true)
    expect(html.includes("Open sessions")).toBe(true)
  })

  test("includes drawer utilities for notifications and session navigation", () => {
    const html = renderWebAppHtml()

    expect(html.includes("drawer-meta")).toBe(true)
    expect(html.includes("Notification settings")).toBe(true)
  })
})
