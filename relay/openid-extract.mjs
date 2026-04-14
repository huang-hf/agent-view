function pickString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : ""
}

export function extractOpenIdCandidates(payload) {
  const out = []
  const push = (v) => {
    const s = pickString(v)
    if (s) out.push(s)
  }

  push(payload?.author?.id)
  push(payload?.openid)
  push(payload?.user_openid)
  push(payload?.group_openid)

  push(payload?.d?.author?.id)
  push(payload?.d?.openid)
  push(payload?.d?.user_openid)
  push(payload?.d?.group_openid)

  const uniq = []
  const seen = new Set()
  for (const id of out) {
    if (seen.has(id)) continue
    seen.add(id)
    uniq.push(id)
  }
  return uniq
}
