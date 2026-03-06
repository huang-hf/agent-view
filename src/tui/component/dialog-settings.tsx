/**
 * Settings dialog
 * Exposes all config.json settings in the TUI
 */

import { createSignal } from "solid-js"
import { InputRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { DialogHeader } from "@tui/ui/dialog-header"
import { DialogFooter } from "@tui/ui/dialog-footer"
import { ActionButton } from "@tui/ui/action-button"
import { useToast } from "@tui/ui/toast"
import { useTheme } from "@tui/context/theme"
import { useSync } from "@tui/context/sync"
import { getConfig, loadConfig, saveConfig } from "@/core/config"
import type { Tool } from "@/core/types"
import { getSshManager } from "@/core/ssh"

const TOOL_OPTIONS: { title: string; value: Tool }[] = [
  { title: "Claude Code", value: "claude" },
  { title: "OpenCode", value: "opencode" },
  { title: "Gemini CLI", value: "gemini" },
  { title: "Codex CLI", value: "codex" },
  { title: "Custom", value: "custom" },
  { title: "Shell", value: "shell" },
]

const HIBERNATE_OPTIONS = [
  { title: "Disabled", value: 0 },
  { title: "30 minutes", value: 30 },
  { title: "1 hour", value: 60 },
  { title: "2 hours", value: 120 },
  { title: "4 hours", value: 240 },
]

function formatHibernate(minutes: number): string {
  if (!minutes) return "Disabled"
  if (minutes < 60) return `${minutes}m`
  return `${minutes / 60}h`
}

export function DialogSettings() {
  const dialog = useDialog()
  const toast = useToast()
  const themeCtx = useTheme()
  const sync = useSync()

  function showSettingsList() {
    const config = getConfig()

    const options = [
      {
        title: "Default tool",
        value: "defaultTool" as const,
        footer: config.defaultTool || "claude",
      },
      {
        title: "Theme",
        value: "theme" as const,
        footer: `${themeCtx.selected} (${themeCtx.mode()})`,
      },
      {
        title: "Default group",
        value: "defaultGroup" as const,
        footer: config.defaultGroup || "default",
      },
      {
        title: "Auto-hibernate idle sessions",
        value: "autoHibernate" as const,
        footer: formatHibernate(config.autoHibernateMinutes || 0),
      },
      {
        title: "Remote hosts",
        value: "remoteHosts" as const,
        footer: `${(config.remoteHosts ?? []).length} configured`,
      },
    ]

    dialog.replace(() => (
      <DialogSelect
        title="Settings"
        options={options}
        skipFilter
        onSelect={(opt) => {
          switch (opt.value) {
            case "defaultTool": return showDefaultTool()
            case "theme": return showTheme()
            case "defaultGroup": return showDefaultGroup()
            case "autoHibernate": return showAutoHibernate()
            case "remoteHosts": return showRemoteHosts()
          }
        }}
      />
    ))
  }

  async function updateConfig(updater: (config: Awaited<ReturnType<typeof loadConfig>>) => Awaited<ReturnType<typeof loadConfig>>) {
    const config = await loadConfig()
    await saveConfig(updater(config))
    toast.show({ message: "Setting saved", variant: "success", duration: 1500 })
    showSettingsList()
  }

  function showDefaultTool() {
    const config = getConfig()
    dialog.replace(() => (
      <DialogSelect
        title="Default tool"
        options={TOOL_OPTIONS}
        current={config.defaultTool || "claude"}
        skipFilter
        onSelect={(opt) => updateConfig((c) => ({ ...c, defaultTool: opt.value }))}
      />
    ))
  }

  function showTheme() {
    const themeNames = themeCtx.all()
    const modes = ["dark", "light"] as const

    const options = themeNames.flatMap((name) =>
      modes.map((mode) => ({
        title: `${name}`,
        value: { name, mode },
        description: mode,
      }))
    )

    const current = { name: themeCtx.selected, mode: themeCtx.mode() }
    dialog.replace(() => (
      <DialogSelect
        title="Theme"
        options={options}
        current={current}
        skipFilter
        onSelect={(opt) => {
          themeCtx.set(opt.value.name)
          themeCtx.setMode(opt.value.mode)
          updateConfig((c) => ({ ...c, theme: opt.value.name }))
        }}
      />
    ))
  }

  function showDefaultGroup() {
    const config = getConfig()
    const groups = sync.group.list()
    const options = groups.map((g) => ({
      title: g.name,
      value: g.path,
    }))
    dialog.replace(() => (
      <DialogSelect
        title="Default group"
        options={options}
        current={config.defaultGroup || "default"}
        skipFilter
        onSelect={(opt) => updateConfig((c) => ({ ...c, defaultGroup: opt.value }))}
      />
    ))
  }

  function showAutoHibernate() {
    const config = getConfig()
    dialog.replace(() => (
      <DialogSelect
        title="Auto-hibernate idle sessions"
        options={HIBERNATE_OPTIONS}
        current={config.autoHibernateMinutes || 0}
        skipFilter
        onSelect={(opt) => updateConfig((c) => ({ ...c, autoHibernateMinutes: opt.value, autoHibernatePrompted: true }))}
      />
    ))
  }

  function showRemoteHosts() {
    const config = getConfig()
    const hosts = config.remoteHosts ?? []

    const options = [
      ...hosts.map(h => ({
        title: h.label || h.alias,
        value: `host:${h.alias}`,
        footer: h.alias,
      })),
      { title: "+ Add remote host", value: "add", footer: "" },
    ]

    dialog.replace(() => (
      <DialogSelect
        title="Remote Hosts"
        options={options}
        skipFilter
        onSelect={(opt) => {
          if (opt.value === "add") {
            showAddRemoteHost()
          } else {
            const alias = opt.value.replace("host:", "")
            showRemoteHostActions(alias)
          }
        }}
      />
    ))
  }

  function showAddRemoteHost() {
    const { theme } = themeCtx

    dialog.push(() => {
      const [alias, setAlias] = createSignal("")
      let inputRef: InputRenderable | undefined

      async function handleAdd() {
        const a = alias().trim()
        if (!a) { dialog.pop(); return }
        const config = getConfig()
        const hosts = [...(config.remoteHosts ?? [])]
        if (!hosts.find(h => h.alias === a)) {
          hosts.push({ alias: a })
          await saveConfig({ ...config, remoteHosts: hosts })
          getSshManager().connect(a).catch(() => {})
          toast.show({ message: `Added ${a}`, variant: "success" })
        }
        dialog.pop()
        showRemoteHosts()
      }

      useKeyboard((evt) => {
        if (evt.name === "return" && !evt.shift) { evt.preventDefault(); handleAdd() }
        if (evt.name === "escape") { evt.preventDefault(); dialog.pop() }
      })

      return (
        <box gap={1} paddingBottom={1}>
          <DialogHeader title="Add Remote Host" />
          <box paddingLeft={4} paddingRight={4} paddingTop={1} gap={1}>
            <text fg={theme.textMuted}>Enter the SSH alias from ~/.ssh/config:</text>
            <input
              placeholder="e.g. gpu-3090"
              value={alias()}
              onInput={setAlias}
              focusedBackgroundColor={theme.backgroundElement}
              cursorColor={theme.primary}
              focusedTextColor={theme.text}
              ref={(r) => {
                inputRef = r
                setTimeout(() => inputRef?.focus(), 1)
              }}
            />
          </box>
          <ActionButton label="Add" loadingLabel="Adding..." loading={false} onAction={handleAdd} />
          <DialogFooter hint="Enter: add | Esc: cancel" />
        </box>
      )
    })
  }

  function showRemoteHostActions(alias: string) {
    dialog.push(() => (
      <DialogSelect
        title={`Host: ${alias}`}
        options={[
          { title: "Test connection", value: "test" },
          { title: "Remove", value: "remove" },
          { title: "Back", value: "back" },
        ]}
        skipFilter
        onSelect={async (opt) => {
          if (opt.value === "test") {
            toast.show({ message: `Testing ${alias}…`, variant: "info" })
            const ok = await getSshManager().check(alias)
            toast.show({
              message: ok ? `✓ ${alias} connected` : `✗ ${alias} unreachable`,
              variant: ok ? "success" : "error"
            })
          } else if (opt.value === "remove") {
            const config = getConfig()
            const hosts = (config.remoteHosts ?? []).filter(h => h.alias !== alias)
            await saveConfig({ ...config, remoteHosts: hosts })
            await getSshManager().disconnect(alias)
            toast.show({ message: `Removed ${alias}`, variant: "success" })
            dialog.pop()
            showRemoteHosts()
          } else {
            dialog.pop()
          }
        }}
      />
    ))
  }

  // Show the settings list on mount
  showSettingsList()

  return <></>
}
