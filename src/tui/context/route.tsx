/**
 * Route context for navigation
 * Based on OpenCode's route context
 */

import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"

export type RouteData =
  | { type: "home" }
  | { type: "session"; sessionId: string }
  | { type: "tasks" }

function sameRoute(a: RouteData, b: RouteData): boolean {
  if (a.type !== b.type) return false
  if (a.type === "session" && b.type === "session") return a.sessionId === b.sessionId
  return true
}

export const { use: useRoute, provider: RouteProvider } = createSimpleContext({
  name: "Route",
  init: () => {
    const [state, setState] = createStore<{
      data: RouteData
      history: RouteData[]
    }>({
      data: { type: "home" },
      history: []
    })

    return {
      get data() {
        return state.data
      },
      navigate(route: RouteData) {
        // No-op when already on the target — avoids polluting the history stack
        // with self-entries (which made route.back() land on the current screen).
        if (sameRoute(state.data, route)) return
        setState("history", [...state.history, state.data])
        setState("data", route)
      },
      back() {
        const previous = state.history.at(-1)
        if (previous) {
          setState("data", previous)
          setState("history", state.history.slice(0, -1))
        }
      },
      canGoBack() {
        return state.history.length > 0
      }
    }
  }
})
