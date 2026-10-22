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
# the full app:  ◐ waiting (needs you) · ● running · ○ idle · ⧗ blocked
# (an idle session you parked with a note via `R` in the TUI)
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
import time
from collections import Counter
from datetime import datetime

HOME = os.path.expanduser("~")
# Env overrides exist for tests: AV_SWIFTBAR_CONFIG / AV_SWIFTBAR_LOG / AV_SWIFTBAR_AV
CONFIG_PATH = os.environ.get("AV_SWIFTBAR_CONFIG") or os.path.join(HOME, ".agent-view", "config.json")
LOG_PATH = os.environ.get("AV_SWIFTBAR_LOG") or os.path.join(HOME, ".agent-orchestrator", "swiftbar.log")
LOG_MAX_LINES = 1000
LOG_KEEP_LINES = 500

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
    "blocked": "⧗",
}


def display_status(s):
    # An idle session carrying a note (set with `R` in the TUI) is parked on
    # purpose — "waiting on something else" — so show it as blocked rather than
    # lumping it in with truly idle sessions. Any other status (running,
    # waiting, …) wins over the note so nothing that needs you gets hidden.
    status = s.get("status", "")
    if status == "idle" and (s.get("note") or "").strip():
        return "blocked"
    return status


def find_av():
    override = os.environ.get("AV_SWIFTBAR_AV")
    if override:
        return override
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
    if out.returncode != 0 or out.stdout.strip() == "":
        err = " / ".join((out.stderr or "").strip().splitlines()[:3])
        raise RuntimeError(f"av exit {out.returncode}: {err}")
    return json.loads(out.stdout)


def load_current_ids():
    # Missing file is legitimate (no Current). A present-but-unparseable file
    # may be a mid-write read, so retry briefly before reporting failure.
    if not os.path.exists(CONFIG_PATH):
        return []
    last = None
    for attempt in range(3):
        try:
            with open(CONFIG_PATH) as f:
                return json.load(f).get("currentSessionIds") or []
        except FileNotFoundError:
            return []
        except Exception as e:
            last = e
            if attempt < 2:
                time.sleep(0.1)
    raise RuntimeError(f"config.json unreadable: {last}")


def log_run(status, w=0, r=0, i=0, b=0, cur=0, error=""):
    # Never raises: logging must not break the plugin.
    try:
        os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
        line = f"{datetime.now().astimezone().isoformat(timespec='seconds')}  {status}  w={w} r={r} i={i} b={b} cur={cur}"
        if error:
            line += "  " + error.replace("\n", " ")
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line + "\n")
        with open(LOG_PATH, encoding="utf-8") as f:
            lines = f.readlines()
        if len(lines) > LOG_MAX_LINES:
            with open(LOG_PATH, "w", encoding="utf-8") as f:
                f.writelines(lines[-LOG_KEEP_LINES:])
    except Exception:
        pass


def print_error(msg):
    print("⚠️ av")
    print("---")
    print(msg.replace("|", "¦").replace("\n", " "))
    print("Refresh | refresh=true")


def main():
    av = find_av()
    try:
        sessions = load_sessions(av)
        current_ids = load_current_ids()
    except Exception as e:
        # av/config unreadable — show ⚠️ (not an empty ◌) and record why.
        msg = str(e) or "agent-view not reachable"
        log_run("error", error=msg)
        print_error(msg)
        return

    by_id = {s.get("id"): s for s in sessions}
    # Preserve the Current order; skip ids whose session no longer exists.
    cur = [by_id[i] for i in current_ids if i in by_id]

    counts = Counter(display_status(s) for s in cur)
    w = counts.get("waiting", 0)
    r = counts.get("running", 0)
    idle = counts.get("idle", 0)
    blocked = counts.get("blocked", 0)
    log_run("ok", w, r, idle, blocked, len(cur))

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
    if blocked:
        segs.append(f"⧗{blocked}")
    title = " ".join(segs) if segs else "◌"
    # When something is waiting on you, the whole title turns orange AND larger
    # so the ◐ is unmissable; otherwise it stays calm at the default size.
    print(f"{title} | color=orange size=16" if w else title)

    # Read-only dropdown for when you do want to peek at which ones. Rows use the
    # default menu color; only the status glyph distinguishes them.
    print("---")
    print(f"Current sessions ({len(cur)}) | size=11")
    for s in cur:
        status = display_status(s)
        dot = DOT.get(status, "◌")
        title = (s.get("title") or "").replace("|", "¦")
        if status == "blocked":
            note = (s.get("note") or "").strip().replace("|", "¦")
            print(f"{dot} {title} — {note} | size=13")
        else:
            print(f"{dot} {title}  ({status}) | size=13")
    print("---")
    print("Refresh | refresh=true")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # never let the plugin die silently
        log_run("error", error=f"unexpected: {e}")
        print_error(f"error: {e}")
        sys.exit(0)
