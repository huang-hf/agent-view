/**
 * Human date labels for the completed-task timeline.
 *
 * Grouping is by local calendar day:
 *   - today            → 今日
 *   - yesterday        → 昨日
 *   - earlier this year→ MMDD        (e.g. 0803)
 *   - previous years   → YYYY/MMDD   (e.g. 2025/1230)
 */

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export function dayLabel(date: Date, now: Date): string {
  const day = startOfDay(date)
  const today = startOfDay(now)

  if (day.getTime() === today.getTime()) return "今日"

  const yesterday = startOfDay(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (day.getTime() === yesterday.getTime()) return "昨日"

  const mm = String(date.getMonth() + 1).padStart(2, "0")
  const dd = String(date.getDate()).padStart(2, "0")
  if (date.getFullYear() === now.getFullYear()) return `${mm}${dd}`
  return `${date.getFullYear()}/${mm}${dd}`
}
