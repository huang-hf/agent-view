export const HOME_PREVIEW_DEBOUNCE_MS = 150
export const HOME_PREVIEW_POLL_MS = 500

export interface PreviewLoopTimers {
  setTimeout: typeof globalThis.setTimeout
  clearTimeout: typeof globalThis.clearTimeout
  setInterval: typeof globalThis.setInterval
  clearInterval: typeof globalThis.clearInterval
}

const defaultTimers: PreviewLoopTimers = {
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
  setInterval: globalThis.setInterval.bind(globalThis),
  clearInterval: globalThis.clearInterval.bind(globalThis)
}

export function startHomePreviewLoop(
  run: () => void | Promise<void>,
  timers: PreviewLoopTimers = defaultTimers
): () => void {
  let stopped = false
  let intervalId: ReturnType<typeof setInterval> | undefined

  const kickoff = timers.setTimeout(() => {
    if (stopped) return
    void run()
    intervalId = timers.setInterval(() => {
      if (stopped) return
      void run()
    }, HOME_PREVIEW_POLL_MS)
  }, HOME_PREVIEW_DEBOUNCE_MS)

  return () => {
    stopped = true
    timers.clearTimeout(kickoff)
    if (intervalId) {
      timers.clearInterval(intervalId)
    }
  }
}
