import { describe, expect, test } from "bun:test"
import { paginateTranscript } from "./transcript"

function makeLines(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `line-${i + 1}`)
}

describe("paginateTranscript", () => {
  test("returns newest lines on first page", () => {
    const lines = makeLines(1000)
    const page = paginateTranscript(lines, { before: 0, limit: 200 })

    expect(page.lines[0]).toBe("line-801")
    expect(page.lines[199]).toBe("line-1000")
    expect(page.hasMore).toBe(true)
    expect(page.nextBefore).toBe(200)
    expect(page.total).toBe(1000)
  })

  test("pages upward from previous cursor", () => {
    const lines = makeLines(1000)
    const first = paginateTranscript(lines, { before: 0, limit: 200 })
    const second = paginateTranscript(lines, { before: first.nextBefore, limit: 200 })

    expect(second.lines[0]).toBe("line-601")
    expect(second.lines[199]).toBe("line-800")
    expect(second.nextBefore).toBe(400)
  })

  test("stops when no more history", () => {
    const lines = makeLines(350)
    const first = paginateTranscript(lines, { before: 0, limit: 200 })
    const second = paginateTranscript(lines, { before: first.nextBefore, limit: 200 })

    expect(second.lines.length).toBe(150)
    expect(second.lines[0]).toBe("line-1")
    expect(second.hasMore).toBe(false)
    expect(second.nextBefore).toBe(350)
  })

  test("applies maxLines window before paging", () => {
    const lines = makeLines(1800)
    const page = paginateTranscript(lines, { before: 0, limit: 200, maxLines: 1000 })

    expect(page.total).toBe(1000)
    expect(page.lines[0]).toBe("line-1601")
    expect(page.lines[199]).toBe("line-1800")
  })
})
