import { describe, expect, test } from "bun:test"
import { parseArgs } from "./args"

describe("parseArgs web mode", () => {
  test("parses --web with defaults", () => {
    const result = parseArgs(["node", "av", "--web"])
    expect(result).toEqual({ type: "web", host: "127.0.0.1", port: 4317 })
  })

  test("parses --web with custom host and port", () => {
    const result = parseArgs(["node", "av", "--web", "--host", "0.0.0.0", "--port", "9000"])
    expect(result).toEqual({ type: "web", host: "0.0.0.0", port: 9000 })
  })
})

describe("parseArgs output/confirm", () => {
  test("parses --confirm", () => {
    const result = parseArgs(["node", "av", "--confirm", "abc"])
    expect(result).toEqual({ type: "confirm", id: "abc" })
  })

  test("parses --output with default lines", () => {
    const result = parseArgs(["node", "av", "--output", "abc"])
    expect(result).toEqual({ type: "output", id: "abc", lines: 200 })
  })

  test("parses --output with explicit lines", () => {
    const result = parseArgs(["node", "av", "--output", "abc", "--lines", "500"])
    expect(result).toEqual({ type: "output", id: "abc", lines: 500 })
  })

  test("parses --interrupt", () => {
    const result = parseArgs(["node", "av", "--interrupt", "abc"])
    expect(result).toEqual({ type: "interrupt", id: "abc" })
  })
})
