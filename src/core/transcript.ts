export interface TranscriptPageOptions {
  before?: number
  limit?: number
  maxLines?: number
}

export interface TranscriptPage {
  lines: string[]
  nextBefore: number
  hasMore: boolean
  total: number
}

export function paginateTranscript(
  rawLines: string[],
  options: TranscriptPageOptions = {}
): TranscriptPage {
  const before = Math.max(0, options.before ?? 0)
  const limit = Math.max(1, options.limit ?? 200)
  const maxLines = Math.max(1, options.maxLines ?? 1000)

  const lines = rawLines.length > maxLines
    ? rawLines.slice(-maxLines)
    : rawLines

  const total = lines.length
  if (total === 0 || before >= total) {
    return {
      lines: [],
      nextBefore: before,
      hasMore: false,
      total,
    }
  }

  const end = total - before
  const start = Math.max(0, end - limit)
  const pageLines = lines.slice(start, end)

  return {
    lines: pageLines,
    nextBefore: before + pageLines.length,
    hasMore: start > 0,
    total,
  }
}
