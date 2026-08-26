#!/usr/bin/env python3
# <xbar.title>Agent View — Current</xbar.title>
# <xbar.version>v1.0</xbar.version>
# <xbar.author>agent-view</xbar.author>
# <xbar.desc>Glanceable status counts for your Current agent-view sessions in the menu bar.</xbar.desc>
# <xbar.dependencies>python3,av</xbar.dependencies>
# <swiftbar.refreshOnOpen>true</swiftbar.refreshOnOpen>
# <swiftbar.hideAbout>true</swiftbar.hideAbout>
# <swiftbar.hideRunInTerminal>true</swiftbar.hideRunInTerminal>
#
# A tiny menu-bar glance for your "Current" agent-view sessions. It shows the
# same status glyphs as the TUI so you can perceive status without looking at
# the full app:  ◐ waiting (needs you) · ● running · ○ idle
# The title turns orange whenever a session is waiting on you.
#
# Install:
#   brew install swiftbar        # once
#   ln -s "$(pwd)/tools/swiftbar/agent-view.3s.py" \
#         "$HOME/Library/Application Support/SwiftBar/agent-view.3s.py"
#   chmod +x tools/swiftbar/agent-view.3s.py
#   (point SwiftBar's plugin folder at the file, or copy it there)
#
# The `.3s.` in the filename = refresh every 3 seconds. Rename to change it.
#
# Note: statuses are only live while an agent-view instance (the TUI or
# `av --web`) is running — that process is what keeps the DB status fresh.

import json
import os
import subprocess
import sys
from collections import Counter

HOME = os.path.expanduser("~")
CONFIG_PATH = os.path.join(HOME, ".agent-view", "config.json")

# Status glyphs matching the agent-view TUI (src/tui/util/status.ts), plus the
# per-status colors it uses. These render in the system menu-bar font, so the
# half-filled ◐ shows at a normal size (unlike a terminal with a thin font).
DOT = {
    "running": "●",
    "waiting": "◐",
    "idle": "○",
    "stopped": "◻",
    "hibernated": "◉",
    "offline": "◌",
}


def find_av():
    for p in (
        os.path.join(HOME, ".local", "bin", "av"),
        "/opt/homebrew/bin/av",
        "/usr/local/bin/av",
    ):
        if os.path.exists(p):
            return p
    return "av"  # hope it's on PATH


def load_sessions(av):
    out = subprocess.run(
        [av, "--list", "--json"],
        capture_output=True,
        text=True,
        timeout=8,
    )
    return json.loads(out.stdout or "[]")


def load_current_ids():
    try:
        with open(CONFIG_PATH) as f:
            return json.load(f).get("currentSessionIds") or []
    except Exception:
        return []


def main():
    av = find_av()
    try:
        sessions = load_sessions(av)
    except Exception:
        # av unreachable — surface it quietly rather than crashing SwiftBar.
        print("⚠️ av")
        print("---")
        print("agent-view not reachable")
        print("Refresh | refresh=true")
        return

    by_id = {s.get("id"): s for s in sessions}
    current_ids = load_current_ids()
    # Preserve the Current order; skip ids whose session no longer exists.
    cur = [by_id[i] for i in current_ids if i in by_id]

    counts = Counter(s.get("status", "") for s in cur)
    w = counts.get("waiting", 0)
    r = counts.get("running", 0)
    idle = counts.get("idle", 0)

    # Menu-bar title: agent-view glyphs, only non-zero active counts so it stays
    # calm until a session needs you. When any session is waiting, the whole
    # title turns orange so the ◐ pops (matches av's amber "waiting").
    segs = []
    if w:
        segs.append(f"◐{w}")
    if r:
        segs.append(f"●{r}")
    if idle:
        segs.append(f"○{idle}")
    title = " ".join(segs) if segs else "◌"
    # When something is waiting on you, the whole title turns orange AND larger
    # so the ◐ is unmissable; otherwise it stays calm at the default size.
    print(f"{title} | color=orange size=16" if w else title)

    # Read-only dropdown for when you do want to peek at which ones. Rows use the
    # default menu color; only the status glyph distinguishes them.
    print("---")
    print(f"Current sessions ({len(cur)}) | size=11")
    for s in cur:
        status = s.get("status", "")
        dot = DOT.get(status, "◌")
        title = (s.get("title") or "").replace("|", "¦")
        print(f"{dot} {title}  ({status}) | size=13")
    print("---")
    print("Refresh | refresh=true")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # never let the plugin die silently
        print("⚠️ av")
        print("---")
        print(f"error: {e}")
        print("Refresh | refresh=true")
        sys.exit(0)
