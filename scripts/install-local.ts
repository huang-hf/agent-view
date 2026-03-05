#!/usr/bin/env bun
/**
 * Build and install agent-view to the local machine.
 *
 * Usage:
 *   bun run scripts/install-local.ts
 *
 * What it does:
 *   1. Builds source (TypeScript + Solid)
 *   2. Compiles to a standalone binary for the current platform
 *   3. Copies binary to ~/.agent-view/bin/agent-view
 *   4. Re-signs with ad-hoc codesign (macOS) to fix "killed" on launch
 */

import path from "path"
import { mkdir, copyFile, chmod } from "fs/promises"
import { existsSync } from "fs"
import solidPlugin from "@opentui/solid/bun-plugin"
import { $ } from "bun"
import os from "os"

const dir = path.resolve(import.meta.dir, "..")
process.chdir(dir)

const DIST_DIR = path.join(dir, "dist")
const INSTALL_BIN = path.join(os.homedir(), ".agent-view", "bin", "agent-view")

// Step 1: Build source
console.log("📦 Building source...")
const result = await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: DIST_DIR,
  target: "bun",
  format: "esm",
  splitting: false,
  sourcemap: "none",
  minify: true,
  plugins: [solidPlugin],
  external: ["bun:sqlite", "node-pty"],
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

// Step 2: Compile binary
const platform = `${process.platform === "darwin" ? "darwin" : "linux"}-${process.arch === "arm64" ? "arm64" : "x64"}`
const target = `bun-${platform}`
const tmpBin = path.join(dir, "bin", "_install-local-tmp")

await mkdir(path.join(dir, "bin"), { recursive: true })
console.log(`🔨 Compiling for ${platform}...`)

const proc = Bun.spawn({
  cmd: ["bun", "build", "--compile", "--target", target, "--outfile", tmpBin, "./dist/index.js"],
  cwd: dir,
  stdout: "pipe",
  stderr: "pipe",
})
const exitCode = await proc.exited
if (exitCode !== 0) {
  const stderr = await new Response(proc.stderr).text()
  console.error("Compile failed:", stderr)
  process.exit(1)
}
await chmod(tmpBin, 0o755)

// Step 3: Copy to install location
if (!existsSync(path.dirname(INSTALL_BIN))) {
  await mkdir(path.dirname(INSTALL_BIN), { recursive: true })
}
await copyFile(tmpBin, INSTALL_BIN)
await chmod(INSTALL_BIN, 0o755)
await $`rm -f ${tmpBin}`

// Step 4: Re-sign on macOS (prevents "killed" due to invalid signature)
if (process.platform === "darwin") {
  console.log("🔏 Re-signing binary (macOS)...")
  await $`codesign --sign - --force ${INSTALL_BIN}`
}

console.log(`✅ Installed to ${INSTALL_BIN}`)
