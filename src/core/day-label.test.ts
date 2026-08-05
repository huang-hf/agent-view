import { describe, expect, test } from "bun:test"
import { dayLabel } from "./day-label"

describe("dayLabel", () => {
  const now = new Date(2026, 7, 5, 14, 30) // 2026-08-05 local

  test("today → 今日 (regardless of time of day)", () => {
    expect(dayLabel(new Date(2026, 7, 5, 0, 1), now)).toBe("今日")
    expect(dayLabel(new Date(2026, 7, 5, 23, 59), now)).toBe("今日")
  })

  test("yesterday → 昨日", () => {
    expect(dayLabel(new Date(2026, 7, 4, 9, 0), now)).toBe("昨日")
  })

  test("earlier this year → MMDD zero-padded", () => {
    expect(dayLabel(new Date(2026, 7, 3, 9, 0), now)).toBe("0803")
    expect(dayLabel(new Date(2026, 0, 9, 9, 0), now)).toBe("0109")
  })

  test("previous years → YYYY/MMDD", () => {
    expect(dayLabel(new Date(2025, 11, 30, 9, 0), now)).toBe("2025/1230")
  })

  test("yesterday across month boundary", () => {
    const firstOfAug = new Date(2026, 7, 1, 10, 0)
    expect(dayLabel(new Date(2026, 6, 31, 10, 0), firstOfAug)).toBe("昨日")
  })

  test("yesterday across year boundary", () => {
    const newYear = new Date(2026, 0, 1, 10, 0)
    expect(dayLabel(new Date(2025, 11, 31, 10, 0), newYear)).toBe("昨日")
  })
})
