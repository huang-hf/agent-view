/**
 * Home screen with dual-column layout
 * Shows session list on left, preview pane on right
 */

import { createMemo, createSignal, For, Show, createEffect, onCleanup, Index, type Accessor } from "solid-js"
import { TextAttributes, ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions, useKeyboard, useRenderer } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useSync } from "@tui/context/sync"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useToast } from "@tui/ui/toast"
import { DialogNew } from "@tui/component/dialog-new"
import type { SavedFormState } from "@tui/component/dialog-new"
import { DialogRename } from "@tui/component/dialog-rename"
import { DialogGroup } from "@tui/component/dialog-group"
import { DialogMove } from "@tui/component/dialog-move"
import { DialogShortcuts } from "@tui/component/dialog-shortcuts"
import { DialogRecents } from "@tui/component/dialog-recents"
import { DialogSettings } from "@tui/component/dialog-settings"
import { DialogHelp } from "@tui/component/dialog-help"
import { getShortcuts, getConfig, saveConfig } from "@/core/config"
import { getSessionManager } from "@/core/session"
import { getSshManager } from "@/core/ssh"
import { executeShortcut, getShortcutGroupPath } from "@/core/shortcut"
import { useKeybind } from "@tui/context/keybind"
import { useRoute } from "@tui/context/route"
import { useKV } from "@tui/context/kv"
import { DialogUpdate } from "@tui/component/dialog-update"
import { capturePane, wasCommandPaletteRequested, sendKeys } from "@/core/tmux"
import { useCommandDialog } from "@tui/component/dialog-command"
import type { Session, Group } from "@/core/types"
import { formatRelativeTime, truncatePath } from "@tui/util/locale"
import { STATUS_ICONS } from "@tui/util/status"
import {
  addCurrentSessionId,
  getInitialCurrentSessionIds,
  getCurrentSessions,
  getCurrentSessionIdsAfterRefresh,
  mergeCurrentSessionSnapshots,
  removeCurrentSessionId
} from "@tui/util/session"
import { createListNavigation } from "@tui/util/navigation"
import { startHomePreviewLoop } from "@tui/util/preview"
import {
  flattenGroupTree,
  prependCurrentGroup,
  prependTasksEntry,
  ensureDefaultGroup,
  getGroupSessionCount,
  getGroupStatusSummary,
  DEFAULT_GROUP_PATH,
  TASKS_ENTRY_PATH,
  type GroupedItem
} from "@tui/util/groups"
import { getStorage } from "@/core/storage"
import { debugLog } from "@/core/debug-log"

function log(...args: unknown[]) {
  debugLog("HOME", ...args)
}

const LOGO = `
 █████╗  ██████╗ ███████╗███╗   ██╗████████╗
██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝
███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║
██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║
██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║
╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝
██╗   ██╗██╗███████╗██╗    ██╗
██║   ██║██║██╔════╝██║    ██║
██║   ██║██║█████╗  ██║ █╗ ██║
╚██╗ ██╔╝██║██╔══╝  ██║███╗██║
 ╚████╔╝ ██║███████╗╚███╔███╔╝
  ╚═══╝  ╚═╝╚══════╝ ╚══╝╚══╝
`.trim()

const SMALL_LOGO = `◆ AGENT VIEW`

function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "")
}

// Minimum width for dual-column layout
const DUAL_COLUMN_MIN_WIDTH = 100
const LEFT_PANEL_MIN_WIDTH = 30
const LEFT_PANEL_MAX_RATIO = 0.5 // Never take more than 50% of screen
const RIGHT_PANEL_MIN_WIDTH = 40 // Always leave room for preview

export function Home() {
  const dimensions = useTerminalDimensions()
  const { theme } = useTheme()
  const sync = useSync()
  const dialog = useDialog()
  const toast = useToast()
  const renderer = useRenderer()
  const command = useCommandDialog()
  const keybind = useKeybind()
  const route = useRoute()
  const kv = useKV()

  const shortcuts = createMemo(() => getShortcuts())
  const updateInfo = () => kv.get<{ current: string; latest: string } | null>("updateInfo", null)

  // Drain auto-hibernated notifications periodically
  const autoHibernateInterval = setInterval(() => {
    const items = sync.session.drainAutoHibernated()
    for (const item of items) {
      toast.show({
        message: `Auto-hibernated ${item.title} (idle ${item.idleMinutes >= 60 ? `${Math.round(item.idleMinutes / 60)}h` : `${item.idleMinutes}m`})`,
        variant: "info",
        duration: 4000
      })
    }
  }, 1000)
  onCleanup(() => clearInterval(autoHibernateInterval))

  const [selectedIndex, setSelectedIndex] = createSignal(0)
  const [inputMode, setInputMode] = createSignal<"keyboard" | "mouse">("keyboard")
  const [previewContent, setPreviewContent] = createSignal<string>("")
  const [previewLoading, setPreviewLoading] = createSignal(false)
  const [currentExpanded, setCurrentExpanded] = createSignal(true)
  const initialSessions = sync.session.list()
  const initialCurrentConfigIds = getConfig().currentSessionIds
  const initialCurrentSessionIds = getInitialCurrentSessionIds(initialCurrentConfigIds, initialSessions)
  const [currentSessionIds, setCurrentSessionIds] = createSignal<string[]>(initialCurrentSessionIds)
  const [currentSessionSnapshots, setCurrentSessionSnapshots] = createSignal<Session[]>(
    getCurrentSessions(initialSessions, { ids: initialCurrentSessionIds })
  )
  let scrollRef: ScrollBoxRenderable | undefined
  let previewScrollRef: ScrollBoxRenderable | undefined
  let stopPreviewLoop: (() => void) | undefined
  let previewFetchAbort = false

  const useDualColumn = createMemo(() => dimensions().width >= DUAL_COLUMN_MIN_WIDTH)

  // Calculate longest session/group title for dynamic panel sizing
  const longestTitleLen = createMemo(() => {
    const sessions = sync.session.list()
    const groups = sync.group.list()
    let maxLen = 0
    for (const s of sessions) {
      if (s.title.length > maxLen) maxLen = s.title.length
    }
    for (const g of groups) {
      if (g.name.length > maxLen) maxLen = g.name.length
    }
    return maxLen
  })

  const leftWidth = createMemo(() => {
    if (!useDualColumn()) return dimensions().width

    // Fixed elements: padding(2) + indent(2) + status(2) + memory(6) = 12
    const fixedWidth = 12
    const neededWidth = longestTitleLen() + fixedWidth

    const maxAllowed = Math.floor(dimensions().width * LEFT_PANEL_MAX_RATIO)
    const minForPreview = dimensions().width - RIGHT_PANEL_MIN_WIDTH - 1

    // Clamp: at least LEFT_PANEL_MIN_WIDTH, at most maxAllowed or what leaves room for preview
    return Math.max(LEFT_PANEL_MIN_WIDTH, Math.min(neededWidth, maxAllowed, minForPreview))
  })

  const rightWidth = createMemo(() => {
    if (!useDualColumn()) return 0
    return dimensions().width - leftWidth() - 1 // -1 for separator
  })

  // Ensure default group exists on first load
  createEffect(() => {
    const currentGroups = sync.group.list()
    const withDefault = ensureDefaultGroup(currentGroups)
    if (withDefault.length !== currentGroups.length) {
      sync.group.save(withDefault)
    }
  })

  const allSessions = createMemo(() => sync.session.list())
  const currentSessions = createMemo(() => currentSessionSnapshots())

  const taskCounts = createMemo(() => {
    const tasks = getStorage().loadTasks()
    return { total: tasks.length, done: tasks.filter(t => t.done).length }
  })

  const groupedItems = createMemo(() => {
    const groups = ensureDefaultGroup(sync.group.list())
    const realGroupedItems = flattenGroupTree(allSessions(), groups)
    const withCurrent = prependCurrentGroup(realGroupedItems, currentSessions(), currentExpanded())
    return prependTasksEntry(withCurrent)
  })

  function sameIds(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((id, idx) => id === b[idx])
  }

  function sameSessions(a: Session[], b: Session[]): boolean {
    return a.length === b.length && a.every((session, idx) => session === b[idx])
  }

  async function persistCurrentSessionIds(ids: string[]) {
    setCurrentSessionIds(ids)
    try {
      await saveConfig({ ...getConfig(), currentSessionIds: ids })
    } catch (err) {
      toast.error(err as Error)
    }
  }

  createEffect(() => {
    const sessions = allSessions()
    const configIds = getConfig().currentSessionIds
    const existingIds = currentSessionIds()
    const nextIds = getCurrentSessionIdsAfterRefresh(existingIds, sessions, {
      hasPersistedIds: configIds !== undefined
    })

    if (!sameIds(existingIds, nextIds) || (configIds === undefined && existingIds.length > 0)) {
      persistCurrentSessionIds(nextIds)
    }
  })

  createEffect(() => {
    const existing = currentSessionSnapshots()
    const next = mergeCurrentSessionSnapshots(existing, allSessions(), currentSessionIds())
    if (!sameSessions(existing, next)) {
      setCurrentSessionSnapshots(next)
    }
  })

  function rememberCurrentSession(session: Session, item: GroupedItem | undefined) {
    if (item?.isCurrent) return
    const nextIds = addCurrentSessionId(currentSessionIds(), session.id)
    if (!sameIds(currentSessionIds(), nextIds)) {
      persistCurrentSessionIds(nextIds)
    }
  }

  function removeSelectedFromCurrent() {
    const item = selectedItem()
    if (item?.type !== "session" || !item.session || !item.isCurrent) {
      toast.show({ message: "Only Current items can be removed from Current", variant: "info", duration: 1500 })
      return
    }

    const nextIds = removeCurrentSessionId(currentSessionIds(), item.session.id)
    persistCurrentSessionIds(nextIds)
    toast.show({ message: "Removed from Current", variant: "info", duration: 1500 })
  }

  createEffect(() => {
    const len = groupedItems().length
    if (selectedIndex() >= len && len > 0) {
      setSelectedIndex(len - 1)
    }
  })

  const selectedItem = createMemo(() => groupedItems()[selectedIndex()])

  const selectedSession = createMemo(() => {
    const item = selectedItem()
    return item?.type === "session" ? item.session : undefined
  })

  const selectedGroup = createMemo(() => {
    const item = selectedItem()
    return item?.type === "group" && !item.isVirtual ? item.group : undefined
  })

  const move = createListNavigation(
    () => groupedItems().length,
    selectedIndex,
    setSelectedIndex
  )

  // Fetch preview with debounce; keep showing previous content while loading
  createEffect(() => {
    const session = selectedSession()

    stopPreviewLoop?.()
    stopPreviewLoop = undefined

    if (!session || !session.tmuxSession) {
      setPreviewContent("")
      setPreviewLoading(false)
      return
    }

    // Only show loading if we have no content yet (first load)
    if (!previewContent()) {
      setPreviewLoading(true)
    }
    previewFetchAbort = false
    // Reset scroll position for new session
    setTimeout(() => {
      if (previewScrollRef) {
        previewScrollRef.scrollTo(previewScrollRef.scrollHeight || 0)
      }
    }, 0)

    stopPreviewLoop = startHomePreviewLoop(async () => {
      if (previewFetchAbort) return

      try {
        let content: string
        if (session.remoteHost) {
          // Remote session: fetch via SSH executor
          content = await getSessionManager().getOutput(session.id, 200)
        } else {
          content = await capturePane(session.tmuxSession, {
            startLine: -200,
            join: true
          })
        }

        if (!previewFetchAbort) {
          setPreviewContent(content)
          // Scroll to bottom after render
          setTimeout(() => {
            if (previewScrollRef) {
              previewScrollRef.scrollTo(previewScrollRef.scrollHeight || 0)
            }
          }, 0)
        }
      } catch {
        // Keep existing content on error, don't clear
      } finally {
        if (!previewFetchAbort) {
          setPreviewLoading(false)
        }
      }
    })
  })

  onCleanup(() => {
    previewFetchAbort = true
    stopPreviewLoop?.()
  })

  const stats = createMemo(() => {
    const byStatus = sync.session.byStatus()
    return {
      running: byStatus.running.length,
      waiting: byStatus.waiting.length,
      total: sync.session.list().length
    }
  })

  function jumpToGroup(groupIndex: number) {
    const items = groupedItems()
    const idx = items.findIndex(item => item.type === "group" && item.groupIndex === groupIndex)
    if (idx >= 0) {
      setSelectedIndex(idx)
    }
  }

  async function handleDeleteGroup(group: Group) {
    const sessionCount = getGroupSessionCount(allSessions(), group.path)

    // Don't allow deleting default group
    if (group.path === DEFAULT_GROUP_PATH) {
      toast.show({ message: "Cannot delete the default group", variant: "error", duration: 2000 })
      return
    }

    // Move sessions to default group before deleting
    if (sessionCount > 0) {
      const sessionsInGroup = allSessions().filter(s => s.groupPath === group.path)
      for (const session of sessionsInGroup) {
        sync.session.moveToGroup(session.id, DEFAULT_GROUP_PATH)
      }
    }

    sync.group.delete(group.path)
    toast.show({ message: `Deleted group "${group.name}"`, variant: "info", duration: 2000 })
    sync.refresh()
  }

  async function doAttach(session: Session, sourceItem?: GroupedItem) {
    previewFetchAbort = true

    // For remote sessions, ensure ControlMaster is alive before suspending the
    // TUI. If the socket is dead (e.g. after laptop sleep), reconnect first so
    // all subsequent SSH commands (conf upload + attach) reuse one multiplexed
    // connection instead of each opening a fresh TCP handshake.
    if (session.remoteHost) {
      const sshMgr = getSshManager()
      const alive = await sshMgr.check(session.remoteHost)
      if (!alive) {
        try {
          await sshMgr.connect(session.remoteHost)
        } catch (err) {
          toast.error(err as Error)
          return
        }
      }
    }

    renderer.suspend()
    try {
      await getSessionManager().attach(session.id)
    } catch (err) {
      console.error("Attach error:", err)
      renderer.resume()
      toast.error(err as Error)
      return
    }
    renderer.resume()
    rememberCurrentSession(session, sourceItem)
    sync.refresh()

    // Check if user pressed Ctrl+K to open command palette (local only)
    if (!session.remoteHost && wasCommandPaletteRequested()) {
      command.open()
    }
  }

  function handleAttach(session: Session, sourceItem = selectedItem()) {
    if (!session.tmuxSession) {
      toast.show({ message: "Session has no tmux session", variant: "error", duration: 2000 })
      return
    }

    // If session is stopped or hibernated, offer to resume or restart
    if (session.status === "stopped" || session.status === "hibernated") {
      const isClaudeWithSession = session.tool === "claude" && session.toolData?.claudeSessionId
      const options = [
        ...(isClaudeWithSession
          ? [{ title: "Resume session", value: "resume" }]
          : []),
        { title: "Restart session", value: "restart" },
      ]

      dialog.replace(() => (
        <DialogSelect
          title={`"${session.title}" is ${session.status}`}
          options={options}
          onSelect={async (opt) => {
            dialog.clear()
            try {
              let updated: Session
              if (opt.value === "resume") {
                updated = await sync.session.resume(session.id)
              } else {
                updated = await sync.session.restart(session.id)
              }
              toast.show({ message: `Session ${opt.value === "resume" ? "resumed" : "restarted"}`, variant: "success", duration: 2000 })
              sync.refresh()
              doAttach(updated, sourceItem)
            } catch (err) {
              toast.error(err as Error)
            }
          }}
        />
      ))
      return
    }

    doAttach(session, sourceItem)
  }

  async function handleDelete(session: Session) {
    if (session.worktreePath) {
      dialog.replace(() => (
        <DialogSelect
          title={`Delete "${session.title}"?`}
          options={[
            { title: "Delete session and worktree", value: "delete-worktree" },
            { title: "Delete session only", value: "delete-session" },
          ]}
          onSelect={async (opt) => {
            dialog.clear()
            try {
              await sync.session.delete(session.id, { deleteWorktree: opt.value === "delete-worktree" })
              const msg = opt.value === "delete-worktree"
                ? `Deleted ${session.title} and worktree`
                : `Deleted ${session.title}`
              toast.show({ message: msg, variant: "info", duration: 2000 })
            } catch (err) {
              toast.error(err as Error)
            }
          }}
        />
      ))
      return
    }
    try {
      await sync.session.delete(session.id)
      toast.show({ message: `Deleted ${session.title}`, variant: "info", duration: 2000 })
    } catch (err) {
      toast.error(err as Error)
    }
  }

  async function handleRestart(session: Session) {
    try {
      await sync.session.restart(session.id)
      toast.show({ message: "Session restarted", variant: "success", duration: 2000 })
      sync.refresh()
    } catch (err) {
      toast.error(err as Error)
    }
  }

  async function handleShortcut(shortcut: ReturnType<typeof getShortcuts>[0]) {
    try {
      const session = await executeShortcut({ shortcut })
      const nextIds = addCurrentSessionId(currentSessionIds(), session.id)
      if (!sameIds(currentSessionIds(), nextIds)) {
        persistCurrentSessionIds(nextIds)
      }
      const groupPath = getShortcutGroupPath(shortcut)
      toast.show({
        message: `Created '${shortcut.name}' in ${groupPath} group`,
        variant: "success",
        duration: 2000
      })

      sync.refresh()
    } catch (err) {
      toast.error(err as Error)
    }
  }

  async function handleHibernate(session: Session) {
    try {
      await sync.session.hibernate(session.id)
      toast.show({ message: `Hibernated ${session.title}`, variant: "success", duration: 2000 })
      sync.refresh()
    } catch (err) {
      toast.error(err as Error)
    }
  }

  useKeyboard((evt) => {
    log("Home useKeyboard:", evt.name, "dialog.stack.length:", dialog.stack.length)

    if (dialog.stack.length > 0) return

    setInputMode("keyboard")

    if (evt.name === "up" || evt.name === "k") {
      move(-1)
    }
    if (evt.name === "down" || evt.name === "j") {
      move(1)
    }
    if (evt.name === "pageup") {
      move(-10)
    }
    if (evt.name === "pagedown") {
      move(10)
    }
    if (evt.name === "home") {
      setSelectedIndex(0)
    }
    if (evt.name === "end") {
      setSelectedIndex(Math.max(0, groupedItems().length - 1))
    }

    // Number keys 1-9 to jump to groups
    if (/^[1-9]$/.test(evt.name)) {
      jumpToGroup(parseInt(evt.name, 10))
    }

    // Right arrow: expand group (or attach to session)
    if (evt.name === "right" || evt.name === "l") {
      const item = selectedItem()
      if (item?.type === "group" && item.virtualType === "tasks") {
        route.navigate({ type: "tasks" })
      } else if (item?.type === "group" && item.virtualType === "current" && !currentExpanded()) {
        setCurrentExpanded(true)
      } else if (item?.type === "group" && item.group && !item.group.expanded) {
        sync.group.toggle(item.group.path)
      } else if (item?.type === "session" && item.session) {
        handleAttach(item.session, item)
      }
    }

    // Left arrow: collapse group
    if (evt.name === "left" || evt.name === "h") {
      const item = selectedItem()
      if (item?.type === "group" && item.virtualType === "current" && currentExpanded()) {
        setCurrentExpanded(false)
      } else if (item?.type === "group" && item.group && item.group.expanded) {
        sync.group.toggle(item.group.path)
      } else if (item?.type === "session" && item.isCurrent) {
        setCurrentExpanded(false)
      } else if (item?.type === "session") {
        // When on a session, collapse its parent group
        const groupItem = groupedItems().find(
          i => i.type === "group" && i.groupPath === item.groupPath && !i.isVirtual
        )
        if (groupItem?.group?.expanded) {
          sync.group.toggle(groupItem.group.path)
        }
      }
    }

    // Enter: attach to session OR toggle group expand/collapse
    if (evt.name === "return") {
      const item = selectedItem()
      if (item?.type === "group" && item.virtualType === "tasks") {
        route.navigate({ type: "tasks" })
      } else if (item?.type === "session" && item.session) {
        handleAttach(item.session, item)
      } else if (item?.type === "group" && item.virtualType === "current") {
        setCurrentExpanded(!currentExpanded())
      } else if (item?.type === "group" && item.group) {
        sync.group.toggle(item.group.path)
      }
    }

    // x to remove a session from Current without affecting the real session.
    if (evt.name === "x" && !evt.shift && !evt.ctrl) {
      removeSelectedFromCurrent()
      return
    }

    // d to delete session OR group
    if (evt.name === "d") {
      const item = selectedItem()
      if (item?.type === "session" && item.session) {
        handleDelete(item.session)
      } else if (item?.type === "group" && item.virtualType === "current") {
        toast.show({ message: "Current is a virtual group", variant: "info", duration: 1500 })
      } else if (item?.type === "group" && item.group) {
        handleDeleteGroup(item.group)
      }
    }

    // r to restart (lowercase only, sessions only)
    if (evt.name === "r" && !evt.shift) {
      const session = selectedSession()
      if (session) {
        dialog.push(() => (
          <DialogSelect
            title={`Restart "${session.title}"?`}
            options={[
              { title: "Restart", value: "restart" },
              { title: "Cancel", value: "cancel" },
            ]}
            onSelect={(opt) => {
              dialog.clear()
              if (opt.value === "restart") {
                handleRestart(session)
              }
            }}
          />
        ))
      }
    }

    // R (Shift+r) to rename session OR group
    if (evt.name === "r" && evt.shift) {
      const item = selectedItem()
      if (item?.type === "session" && item.session) {
        dialog.push(() => <DialogRename session={item.session!} />)
      } else if (item?.type === "group" && item.virtualType === "current") {
        toast.show({ message: "Current is a virtual group", variant: "info", duration: 1500 })
      } else if (item?.type === "group" && item.group) {
        dialog.push(() => <DialogGroup mode="rename" group={item.group!} />)
      }
    }

    // g to create new group
    if (evt.name === "g" && !evt.shift) {
      evt.preventDefault()
      dialog.push(() => <DialogGroup mode="create" />)
      return
    }

    // m to move session to group
    if (evt.name === "m") {
      const session = selectedSession()
      if (session) {
        dialog.push(() => <DialogMove session={session} />)
      }
    }

    // f to duplicate session
    if (evt.name === "f" && !evt.shift) {
      const session = selectedSession()
      if (!session) return

      const remoteHosts = getConfig().remoteHosts ?? []
      const hostIndex = session.remoteHost
        ? remoteHosts.findIndex(h => h.alias === session.remoteHost)
        : 0

      const TOOLS = ["claude", "opencode", "gemini", "codex", "custom", "shell"]
      const toolIndex = Math.max(0, TOOLS.indexOf(session.tool))

      const prefill: SavedFormState = {
        title: `${session.title}-fork`,
        selectedTool: session.tool,
        toolIndex,
        claudeSessionMode: "new",
        skipPermissions: false,
        customCommand: session.command ?? "",
        projectPath: session.worktreeRepo || session.projectPath,
        useWorktree: !!session.worktreeRepo,
        worktreeBranch: "",
        selectedRemoteHost: session.remoteHost ?? "",
        hostIndex: hostIndex >= 0 ? hostIndex : 0,
        groupPath: session.groupPath || undefined,
      }
      evt.preventDefault()
      dialog.push(() => <DialogNew prefill={prefill} />)
      return
    }

    // z to hibernate session
    if (evt.name === "z" && !evt.shift && !evt.ctrl) {
      const session = selectedSession()
      if (session) {
        if (session.tool !== "claude" || !session.toolData?.claudeSessionId) {
          toast.show({ message: "Only Claude sessions with a session ID can be hibernated", variant: "error", duration: 2000 })
          return
        }
        if (session.status === "stopped" || session.status === "hibernated") {
          toast.show({ message: "Session is already stopped/hibernated", variant: "error", duration: 2000 })
          return
        }
        handleHibernate(session)
      }
      return
    }

    // y to quick-confirm a waiting session without attaching.
    // Codex commonly uses [y/N], so it needs an explicit "y" before Enter.
    if (evt.name === "y" && !evt.shift && !evt.ctrl) {
      const session = selectedSession()
      log("y pressed: session=", session?.id, "status=", session?.status, "tmux=", session?.tmuxSession, "remote=", session?.remoteHost)
      if (session && session.status === "waiting" && session.tmuxSession) {
        const item = selectedItem()
        const confirmInput = session.tool === "codex" ? "y" : ""
        getSessionManager().confirmWaiting(session.id, confirmInput).then(() => {
          log("y confirmWaiting success")
          rememberCurrentSession(session, item)
          toast.show({ message: "✓ Confirmed", variant: "success", duration: 1500 })
          sync.refresh()
        }).catch((err) => {
          log("y confirmWaiting error:", err)
          toast.error(err as Error)
        })
      } else {
        log("y: condition not met, session=", !!session, "status=", session?.status, "tmux=", !!session?.tmuxSession)
      }
      return
    }

    // u to open update dialog
    if (evt.name === "u" && !evt.shift && !evt.ctrl) {
      const info = updateInfo()
      if (info) {
        dialog.push(() => <DialogUpdate current={info.current} latest={info.latest} />)
      }
      return
    }

    // s to open shortcuts dialog
    if (evt.name === "s" && !evt.shift && !evt.ctrl) {
      dialog.push(() => <DialogShortcuts />)
      return
    }

    // o to open recents dialog
    if (evt.name === "o" && !evt.shift && !evt.ctrl) {
      dialog.push(() => <DialogRecents />)
      return
    }

    // c to open settings dialog
    if (evt.name === "c" && !evt.shift && !evt.ctrl) {
      dialog.push(() => <DialogSettings />)
      return
    }

    // t to open task board
    if (evt.name === "t" && !evt.shift && !evt.ctrl) {
      route.navigate({ type: "tasks" })
      return
    }

    // ? to open help dialog
    if (evt.name === "?") {
      dialog.push(() => <DialogHelp />)
      return
    }

    const currentShortcuts = shortcuts()
    for (const shortcut of currentShortcuts) {
      if (shortcut.keybind && keybind.matchDynamic(shortcut.keybind, evt)) {
        handleShortcut(shortcut)
        return
      }
    }
  })

  const previewLines = createMemo(() => {
    const content = previewContent()
    if (!content) return []

    const lines = content.split("\n")
    while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") {
      lines.pop()
    }
    return lines
  })

  function GroupHeader(props: { item: GroupedItem; index: number }) {
    const isSelected = createMemo(() => props.index === selectedIndex())
    const group = createMemo(() => props.item.group!)
    const statusSummary = createMemo(() => {
      if (props.item.virtualType === "current") {
        const sessions = currentSessions()
        return {
          running: sessions.filter(s => s.status === "running").length,
          waiting: sessions.filter(s => s.status === "waiting").length
        }
      }
      return getGroupStatusSummary(allSessions(), group().path)
    })

    return (
      <box
        flexDirection="row"
        paddingLeft={1}
        paddingRight={1}
        height={1}
        backgroundColor={isSelected() ? theme.primary : theme.backgroundElement}
        onMouseMove={() => setInputMode("mouse")}
        onMouseUp={() => {
          setInputMode("mouse")
          setSelectedIndex(props.index)
          if (props.item.virtualType === "tasks") {
            route.navigate({ type: "tasks" })
          } else if (props.item.virtualType === "current") {
            setCurrentExpanded(!currentExpanded())
          } else {
            sync.group.toggle(group().path)
          }
        }}
        onMouseOver={() => {
          if (inputMode() === "mouse") setSelectedIndex(props.index)
        }}
      >
        {/* Icon / arrow */}
        <text fg={isSelected() ? theme.selectedListItemText : theme.accent}>
          {props.item.virtualType === "tasks" ? "\u2630 " : group().expanded ? "\u25BC " : "\u25B6 "}
        </text>

        {/* Group name */}
        <text
          fg={isSelected() ? theme.selectedListItemText : theme.text}
          attributes={TextAttributes.BOLD}
        >
          {group().name}
        </text>

        {/* Spacer */}
        <text flexGrow={1}> </text>

        {/* Tasks: show done/total count */}
        <Show when={props.item.virtualType === "tasks"}>
          <text fg={isSelected() ? theme.selectedListItemText : theme.border}>
            {`${taskCounts().done}/${taskCounts().total}`}
          </text>
        </Show>

        {/* Regular groups: status indicators */}
        <Show when={props.item.virtualType !== "tasks"}>
          <Show when={statusSummary().running > 0}>
            <text fg={isSelected() ? theme.selectedListItemText : theme.success}>
              {STATUS_ICONS.running}{statusSummary().running}
            </text>
            <text> </text>
          </Show>
          <Show when={statusSummary().waiting > 0}>
            <text fg={isSelected() ? theme.selectedListItemText : theme.warning}>
              {STATUS_ICONS.waiting}{statusSummary().waiting}
            </text>
          </Show>
        </Show>
      </box>
    )
  }

  function SessionItem(props: { session: Session; index: number; indented?: boolean }) {
    const isSelected = createMemo(() => props.index === selectedIndex())
    const statusColor = createMemo(() => {
      switch (props.session.status) {
        case "running": return theme.success
        case "waiting": return theme.warning
        case "hibernated": return theme.secondary
        case "offline": return theme.textMuted
        default: return theme.textMuted
      }
    })

    const indent = props.indented ? 2 : 0

    // Calculate available space for title dynamically
    // Layout: [padding] [indent] [status icon + space] [title] [spacer] [memory?] [padding]
    const reservedWidth = createMemo(() => {
      let reserved = 2 // left + right padding
      reserved += indent // indentation
      reserved += 2 // status icon + space
      reserved += 6 // memory indicator (e.g., "512M ")
      if (!useDualColumn()) {
        reserved += 8 // tool name + space in single column mode
      }
      return reserved
    })

    const maxTitleLen = createMemo(() => Math.max(10, leftWidth() - reservedWidth()))
    const title = createMemo(() => {
      const max = maxTitleLen()
      return props.session.title.length > max
        ? props.session.title.slice(0, max - 2) + ".."
        : props.session.title
    })

    return (
      <box
        flexDirection="row"
        paddingLeft={1 + indent}
        paddingRight={1}
        height={1}
        backgroundColor={isSelected() ? theme.primary : undefined}
        onMouseMove={() => setInputMode("mouse")}
        onMouseUp={() => {
          setInputMode("mouse")
          setSelectedIndex(props.index)
          handleAttach(props.session, groupedItems()[props.index])
        }}
        onMouseOver={() => {
          if (inputMode() === "mouse") setSelectedIndex(props.index)
        }}
      >
        {/* Status icon with fixed width */}
        <box width={2} flexShrink={0}>
          <text fg={isSelected() ? theme.selectedListItemText : statusColor()}>
            {STATUS_ICONS[props.session.status]}
          </text>
        </box>

        {/* Remote host tag */}
        <Show when={props.session.remoteHost}>
          <text fg={isSelected() ? theme.selectedListItemText : theme.textMuted}>
            [{props.session.remoteHost}]{" "}
          </text>
        </Show>

        {/* Title */}
        <text
          fg={isSelected() ? theme.selectedListItemText : theme.text}
          attributes={isSelected() ? TextAttributes.BOLD : undefined}
        >
          {title()}
        </text>

        {/* Spacer */}
        <text flexGrow={1}> </text>

        {/* Tool (only in single column) */}
        <Show when={!useDualColumn()}>
          <text fg={isSelected() ? theme.selectedListItemText : theme.accent}>
            {props.session.tool}
          </text>
          <text> </text>
        </Show>

        {/* Memory or hibernation indicator */}
        <Show when={props.session.status === "hibernated"} fallback={
          <Show when={sync.session.getMemoryMB(props.session.id)}>
            {(mb: () => number) => (
              <box flexShrink={0}>
                <text fg={isSelected() ? theme.selectedListItemText : theme.textMuted}>
                  {" " + (mb() >= 1024 ? `${(mb() / 1024).toFixed(1)}G` : `${mb()}M`)}
                </text>
              </box>
            )}
          </Show>
        }>
          <box flexShrink={0}>
            <text fg={theme.textMuted}>{" zzz"}</text>
          </box>
        </Show>

      </box>
    )
  }

  function PreviewHeader() {
    const session = () => selectedSession()

    const statusColor = createMemo(() => {
      const s = session()
      if (!s) return theme.textMuted
      switch (s.status) {
        case "running": return theme.success
        case "waiting": return theme.warning
        case "hibernated": return theme.secondary
        default: return theme.textMuted
      }
    })

    return (
      <Show when={session()}>
        {(s: Accessor<Session>) => (
          <box flexDirection="column" paddingLeft={1} paddingRight={1}>
            {/* Session title and status */}
            <box flexDirection="row" justifyContent="space-between" height={1}>
              <text fg={theme.text} attributes={TextAttributes.BOLD}>
                {s().title}
              </text>
              <box flexDirection="row" gap={1}>
                <text fg={statusColor()}>{STATUS_ICONS[s().status]}</text>
                <text fg={statusColor()}>{s().status}</text>
                <Show when={s().status === "waiting"}>
                  <text fg={theme.warning}>  [y] confirm</text>
                </Show>
              </box>
            </box>

            {/* Session info */}
            <box flexDirection="row" gap={2} height={1}>
              <text fg={theme.textMuted}>{truncatePath(s().projectPath, rightWidth() - 20)}</text>
            </box>

            {/* Time and tool info */}
            <box flexDirection="row" gap={2} height={1}>
              <text fg={theme.accent}>{s().tool}</text>
              <text fg={theme.textMuted}>{formatRelativeTime(s().lastAccessed)}</text>
              <Show when={s().worktreeBranch}>
                <text fg={theme.info}>{s().worktreeBranch}</text>
              </Show>
              <Show when={s().remoteHost}>
                {() => {
                  const sshStatus = getSshManager().getStatus(s().remoteHost)
                  const indicator = sshStatus === "connected" ? "●"
                    : sshStatus === "connecting" ? "…"
                    : "○"
                  const color = sshStatus === "connected" ? theme.success
                    : sshStatus === "connecting" ? theme.warning
                    : theme.textMuted
                  return <text fg={color}>{indicator} {s().remoteHost}</text>
                }}
              </Show>
            </box>

            {/* Separator */}
            <box height={1}>
              <text fg={theme.border}>{"─".repeat(rightWidth() - 2)}</text>
            </box>
          </box>
        )}
      </Show>
    )
  }

  function EmptyState() {
    return (
      <box flexGrow={1} alignItems="center" justifyContent="center" flexDirection="column" gap={2}>
        <text fg={theme.primary}>{LOGO}</text>
        <box height={1} />
        <text fg={theme.textMuted}>No sessions yet</text>
        <box flexDirection="row">
          <text fg={theme.textMuted}>Press </text>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>n</text>
          <text fg={theme.textMuted}> to create a new session</text>
        </box>
      </box>
    )
  }

  function PreviewLogo() {
    return (
      <box flexGrow={1} alignItems="center" justifyContent="center" flexDirection="column">
        <text fg={theme.primary}>{LOGO}</text>
        <box height={2} />
        <text fg={theme.textMuted}>Select a session to see preview</text>
      </box>
    )
  }

  return (
    <box
      flexDirection="column"
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor={theme.background}
    >
      {/* Header */}
      <box
        flexDirection="row"
        justifyContent="space-between"
        paddingLeft={2}
        paddingRight={2}
        height={1}
        backgroundColor={theme.backgroundPanel}
      >
        <text fg={theme.primary} attributes={TextAttributes.BOLD}>
          AGENT VIEW
        </text>
        <box flexDirection="row" gap={2}>
          <Show when={stats().running > 0}>
            <text fg={theme.success}>● {stats().running}</text>
          </Show>
          <Show when={stats().waiting > 0}>
            <text fg={theme.warning}>◐ {stats().waiting}</text>
          </Show>
          <text fg={theme.textMuted}>{stats().total} sessions</text>
        </box>
      </box>

      {/* Main content area */}
      <Show
        when={allSessions().length > 0}
        fallback={<EmptyState />}
      >
        <box flexDirection="row" flexGrow={1}>
          {/* Left panel: Session list */}
          <box flexDirection="column" width={leftWidth()}>
            {/* Panel title */}
            <box
              height={1}
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={theme.backgroundElement}
            >
              <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
                SESSIONS
              </text>
            </box>

            {/* Session list (grouped) */}
            <scrollbox
              flexGrow={1}
              scrollbarOptions={{ visible: true }}
              ref={(r: ScrollBoxRenderable) => { scrollRef = r }}
            >
              <Index each={groupedItems()}>
                {(item, index) => (
                  <Show
                    when={item().type === "group"}
                    fallback={
                      <SessionItem
                        session={item().session!}
                        index={index}
                        indented={true}
                      />
                    }
                  >
                    <GroupHeader item={item()} index={index} />
                  </Show>
                )}
              </Index>
            </scrollbox>
          </box>

          {/* Separator */}
          <Show when={useDualColumn()}>
            <box width={1} backgroundColor={theme.border}>
              <text fg={theme.border}>│</text>
            </box>
          </Show>

          {/* Right panel: Preview */}
          <Show when={useDualColumn()}>
            <box flexDirection="column" width={rightWidth()}>
              {/* Panel title */}
              <box
                height={1}
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={theme.backgroundElement}
              >
                <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
                  PREVIEW
                </text>
              </box>

              {/* Preview content */}
              <Show
                when={selectedSession()}
                fallback={<PreviewLogo />}
              >
                <box flexDirection="column" flexGrow={1}>
                  <PreviewHeader />

                  {/* Terminal output */}
                  <scrollbox flexGrow={1} scrollbarOptions={{ visible: true }} ref={(r: ScrollBoxRenderable) => { previewScrollRef = r }}>
                    <Show
                      when={previewLines().length > 0}
                      fallback={
                        <box paddingLeft={1} paddingTop={1}>
                          <text fg={theme.textMuted}>
                            {previewLoading() ? "Loading..." : "No output yet"}
                          </text>
                        </box>
                      }
                    >
                      <box flexDirection="column" paddingLeft={1}>
                        <For each={previewLines().slice(-50)}>
                          {(line) => (
                            <text fg={theme.text}>{stripAnsi(line).slice(0, rightWidth() - 4)}</text>
                          )}
                        </For>
                      </box>
                    </Show>
                  </scrollbox>
                </box>
              </Show>
            </box>
          </Show>
        </box>
      </Show>

      {/* Footer with keybinds */}
      <box
        flexDirection="row"
        width={dimensions().width}
        paddingLeft={2}
        paddingRight={2}
        height={2}
        backgroundColor={theme.backgroundPanel}
        justifyContent="space-between"
      >
        <box flexDirection="column" alignItems="center">
          <text fg={theme.text}>Enter</text>
          <text fg={theme.textMuted}>attach</text>
        </box>
        <box flexDirection="column" alignItems="center">
          <text fg={theme.text}>n</text>
          <text fg={theme.textMuted}>new</text>
        </box>
        <box flexDirection="column" alignItems="center">
          <text fg={theme.text}>g</text>
          <text fg={theme.textMuted}>group</text>
        </box>
        <box flexDirection="column" alignItems="center">
          <text fg={theme.text}>m</text>
          <text fg={theme.textMuted}>move</text>
        </box>
        <box flexDirection="column" alignItems="center">
          <text fg={theme.text}>d</text>
          <text fg={theme.textMuted}>delete</text>
        </box>
        <box flexDirection="column" alignItems="center">
          <text fg={theme.text}>R</text>
          <text fg={theme.textMuted}>rename</text>
        </box>
        <box flexDirection="column" alignItems="center">
          <text fg={theme.text}>f</text>
          <text fg={theme.textMuted}>dup</text>
        </box>
        <box flexDirection="column" alignItems="center">
          <text fg={theme.text}>z</text>
          <text fg={theme.textMuted}>hibernate</text>
        </box>
        <Show when={selectedSession()?.status === "waiting"}>
          <box flexDirection="column" alignItems="center">
            <text fg={theme.warning}>y</text>
            <text fg={theme.warning}>confirm</text>
          </box>
        </Show>
        <box flexDirection="column" alignItems="center">
          <text fg={theme.text}>o</text>
          <text fg={theme.textMuted}>recents</text>
        </box>
        <box flexDirection="column" alignItems="center">
          <text fg={theme.text}>s</text>
          <text fg={theme.textMuted}>shortcuts</text>
        </box>
        <box flexDirection="column" alignItems="center">
          <text fg={theme.text}>c</text>
          <text fg={theme.textMuted}>settings</text>
        </box>
        <box flexDirection="column" alignItems="center">
          <text fg={theme.text}>q</text>
          <text fg={theme.textMuted}>quit</text>
        </box>
        <box flexDirection="column" alignItems="center">
          <text fg={theme.text}>?</text>
          <text fg={theme.textMuted}>help</text>
        </box>
        <Show when={updateInfo()}>
          <box flexDirection="column" alignItems="center">
            <text fg={theme.success}>u</text>
            <text fg={theme.success}>update</text>
          </box>
        </Show>
      </box>
    </box>
  )
}
