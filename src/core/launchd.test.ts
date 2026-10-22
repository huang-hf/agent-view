import { test, expect } from "bun:test"
import { buildPlist, buildAgentPath, LAUNCH_AGENT_LABEL, monitorLogFile } from "./launchd"

test("buildPlist embeds label, av path + --monitor, and keepalive", () => {
  const xml = buildPlist("/Users/me/.agent-view/bin/agent-view", "/usr/bin:/bin")
  expect(xml).toContain("<?xml")
  expect(xml).toContain(`<string>${LAUNCH_AGENT_LABEL}</string>`)
  expect(xml).toContain("<string>/Users/me/.agent-view/bin/agent-view</string>")
  expect(xml).toContain("<string>--monitor</string>")
  expect(xml).toContain("<key>RunAtLoad</key>")
  expect(xml).toContain("<key>KeepAlive</key>")
  expect(xml).toContain("<key>SuccessfulExit</key>")
  expect(xml).toContain(monitorLogFile())
})

test("buildPlist XML-escapes the av path", () => {
  const xml = buildPlist("/tmp/a&b/av", "/usr/bin")
  expect(xml).toContain("/tmp/a&amp;b/av")
  expect(xml).not.toContain("/tmp/a&b/av")
})

test("buildPlist sets EnvironmentVariables PATH (escaped)", () => {
  const xml = buildPlist("/x/av", "/opt/a&b/bin:/usr/bin")
  expect(xml).toContain("<key>EnvironmentVariables</key>")
  expect(xml).toContain("<key>PATH</key>")
  expect(xml).toContain("<string>/opt/a&amp;b/bin:/usr/bin</string>")
})

test("buildAgentPath dedups, preserves order, and always has defaults", () => {
  const p = buildAgentPath("/custom/bin:/usr/bin:/custom/bin")
  const parts = p.split(":")
  expect(parts[0]).toBe("/custom/bin")
  expect(parts.filter((x) => x === "/usr/bin").length).toBe(1)
  for (const d of ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]) {
    expect(parts).toContain(d)
  }
  expect(buildAgentPath(undefined)).toContain("/opt/homebrew/bin")
})

test("buildPlist sets a UTF-8 LANG so tmux output isn't mangled", () => {
  const xml = buildPlist("/x/av", "/usr/bin")
  expect(xml).toContain("<key>LANG</key>")
  expect(xml).toContain("<string>en_US.UTF-8</string>")
})
