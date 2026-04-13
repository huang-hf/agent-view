import { describe, expect, test } from "bun:test"
import { parseArgs } from "./args"

describe("parseArgs", () => {
  test("parses -r as run mode", () => {
    const cmd = parseArgs(["node", "av", "-r"])
    expect((cmd as any).type).toBe("run")
  })

  test("parses --run as run mode", () => {
    const cmd = parseArgs(["node", "av", "--run"])
    expect((cmd as any).type).toBe("run")
  })
})
