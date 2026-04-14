import { describe, test, expect } from "bun:test"
import { extractOpenIdCandidates } from "./openid-extract.mjs"

describe("extractOpenIdCandidates", () => {
  test("extracts author.id and openid from common callback payload", () => {
    const payload = {
      author: { id: "author_123" },
      openid: "openid_abc",
      d: { author: { id: "d_author_1" }, openid: "d_openid_2" },
    }
    const ids = extractOpenIdCandidates(payload)
    expect(ids).toContain("author_123")
    expect(ids).toContain("openid_abc")
    expect(ids).toContain("d_author_1")
    expect(ids).toContain("d_openid_2")
  })

  test("deduplicates and ignores invalid values", () => {
    const payload = {
      author: { id: "same" },
      d: { author: { id: "same" } },
      openid: "",
      user_openid: "user_1",
    }
    const ids = extractOpenIdCandidates(payload)
    expect(ids).toEqual(["same", "user_1"])
  })
})
