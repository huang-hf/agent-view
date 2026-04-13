/**
 * Configuration loader for agent-view
 * Reads from ~/.agent-view/config.json
 */

import * as path from "path"
import * as os from "os"
import * as fs from "fs/promises"
import type { Tool, Shortcut, Recent, RemoteHost } from "./types"

export interface WorktreeConfig {
  defaultBaseBranch?: string
  autoCleanup?: boolean
  syncRemoteBranch?: string  // if set, fetch remote and base new worktrees on this branch (e.g. "origin/main")
}

export interface AppConfig {
  defaultTool?: Tool
  theme?: string
  worktree?: WorktreeConfig
  defaultGroup?: string
  shortcuts?: Shortcut[]
  recents?: Recent[]
  autoHibernateMinutes?: number   // 0 = disabled, default 0
  autoHibernatePrompted?: boolean // true = user has seen the prompt
  remoteHosts?: RemoteHost[]
  copyClaudeDir?: boolean  // true = copy .claude dir to worktree (default true)
  notify?: NotifyConfig
}

export interface NotifyActionServerConfig {
  enabled?: boolean
  host?: string
  port?: number
  path?: string
  secretEnv?: string
}

export interface NotifyConfig {
  enabled?: boolean
  webhookUrl?: string
  webhookTokenEnv?: string
  cooldownSeconds?: number
  tokenTtlSeconds?: number
  pollIntervalMs?: number
  actionServer?: NotifyActionServerConfig
}

const CONFIG_DIR = path.join(os.homedir(), ".agent-view")
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json")

const DEFAULT_CONFIG: AppConfig = {
  defaultTool: "claude",
  theme: "dark",
  worktree: {
    defaultBaseBranch: "main",
    autoCleanup: true
  },
  defaultGroup: "default",
  shortcuts: [],
  recents: [],
  notify: {
    enabled: false,
    cooldownSeconds: 300,
    tokenTtlSeconds: 300,
    pollIntervalMs: 500,
    actionServer: {
      enabled: false,
      host: "127.0.0.1",
      port: 5177,
      path: "/notify/action",
      secretEnv: "AV_NOTIFY_ACTION_SECRET"
    }
  }
}

// Cached config for sync access
let cachedConfig: AppConfig = { ...DEFAULT_CONFIG }

export async function ensureConfigDir(): Promise<void> {
  try {
    await fs.mkdir(CONFIG_DIR, { recursive: true })
  } catch (err) {
    // Directory might already exist
  }
}

/**
 * Load configuration from disk, merging with defaults
 */
export async function loadConfig(): Promise<AppConfig> {
  try {
    const content = await fs.readFile(CONFIG_PATH, "utf-8")
    const parsed = JSON.parse(content) as Partial<AppConfig>

    cachedConfig = {
      ...DEFAULT_CONFIG,
      ...parsed,
      worktree: {
        ...DEFAULT_CONFIG.worktree,
        ...parsed.worktree
      },
      // Shortcuts array is replaced entirely, not merged with defaults
      shortcuts: parsed.shortcuts || [],
      recents: parsed.recents || []
    }

    return cachedConfig
  } catch (err: any) {
    if (err.code === "ENOENT") {
      cachedConfig = { ...DEFAULT_CONFIG }
      return cachedConfig
    }

    console.warn(`Warning: Failed to load config from ${CONFIG_PATH}: ${err.message}`)
    cachedConfig = { ...DEFAULT_CONFIG }
    return cachedConfig
  }
}

/**
 * Get shortcuts from the cached config
 */
export function getShortcuts(): Shortcut[] {
  return cachedConfig.shortcuts || []
}

/**
 * Get recents from the cached config
 */
export function getRecents(): Recent[] {
  return cachedConfig.recents || []
}

/**
 * Get the cached config synchronously
 * Call loadConfig() first to ensure config is loaded
 */
export function getConfig(): AppConfig {
  return cachedConfig
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await ensureConfigDir()
  const content = JSON.stringify(config, null, 2)
  await fs.writeFile(CONFIG_PATH, content, "utf-8")
  cachedConfig = config
}

export function getConfigDir(): string {
  return CONFIG_DIR
}

export function getConfigPath(): string {
  return CONFIG_PATH
}

/**
 * Get default config (for reference)
 */
export function getDefaultConfig(): AppConfig {
  return { ...DEFAULT_CONFIG }
}
