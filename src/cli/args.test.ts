import { describe, expect, test } from "bun:test"
import { parseArgs } from "./args"

describe("parseArgs web mode", () => {
  test("parses --web with defaults", () => {
    const result = parseArgs(["node", "av", "--web"])
    expect(result).toEqual({ type: "web", host: "0.0.0.0", port: 4317, noServe: false, restartWeb: false, daemon: false })
  })

  test("parses --web with custom host and port", () => {
    const result = parseArgs(["node", "av", "--web", "--host", "0.0.0.0", "--port", "9000"])
    expect(result).toEqual({ type: "web", host: "0.0.0.0", port: 9000, noServe: false, restartWeb: false, daemon: false })
  })

  test("parses --web --no-serve", () => {
    const result = parseArgs(["node", "av", "--web", "--no-serve"])
    expect(result).toEqual({ type: "web", host: "0.0.0.0", port: 4317, noServe: true, restartWeb: false, daemon: false })
  })

  test("parses --web --restart-web", () => {
    const result = parseArgs(["node", "av", "--web", "--restart-web"])
    expect(result).toEqual({ type: "web", host: "0.0.0.0", port: 4317, noServe: false, restartWeb: true, daemon: false })
  })

  test("parses --web --daemon", () => {
    const result = parseArgs(["node", "av", "--web", "--daemon"])
    expect(result).toEqual({ type: "web", host: "0.0.0.0", port: 4317, noServe: false, restartWeb: false, daemon: true })
  })

  test("parses --all with defaults", () => {
    const result = parseArgs(["node", "av", "--all"])
    expect(result).toEqual({ type: "all", mode: "dark", host: "0.0.0.0", port: 4317, noServe: false, restartWeb: false })
  })

  test("parses --all --restart-web", () => {
    const result = parseArgs(["node", "av", "--all", "--restart-web"])
    expect(result).toEqual({ type: "all", mode: "dark", host: "0.0.0.0", port: 4317, noServe: false, restartWeb: true })
  })
})

describe("parseArgs output/confirm", () => {
  test("parses --acknowledge", () => {
    const result = parseArgs(["node", "av", "--acknowledge", "abc"])
    expect(result).toEqual({ type: "acknowledge", id: "abc" })
  })

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
