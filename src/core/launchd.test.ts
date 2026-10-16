import { test, expect } from "bun:test"
import { buildPlist, LAUNCH_AGENT_LABEL, monitorLogFile } from "./launchd"

test("buildPlist embeds label, av path + --monitor, and keepalive", () => {
  const xml = buildPlist("/Users/me/.agent-view/bin/agent-view")
  expect(xml).toContain("<?xml")
  expect(xml).toContain(`<string>${LAUNCH_AGENT_LABEL}</string>`)
  expect(xml).toContain("<string>/Users/me/.agent-view/bin/agent-view</string>")
  expect(xml).toContain("<string>--monitor</string>")
  expect(xml).toContain("<key>RunAtLoad</key>")
  expect(xml).toContain("<key>KeepAlive</key>")
  expect(xml).toContain(monitorLogFile())
})
