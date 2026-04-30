import { describe, test, expect } from "bun:test"
import { EventEmitter } from "events"
import { attachWithLocalDetach, resolveSshControlPath, SshControlManager, SshTmuxExecutor } from "./ssh"

class FakeStdin extends EventEmitter {
  isTTY = true
  rawModes: boolean[] = []
  resumed = false

  setRawMode(value: boolean) {
    this.rawModes.push(value)
  }

  resume() {
    this.resumed = true
  }
}

class FakeStdout {
  writes: string[] = []

  write(chunk: string) {
    this.writes.push(chunk)
    return true
  }
}

class FakeChild extends EventEmitter {
  killSignals: Array<NodeJS.Signals | number | undefined> = []

  kill(signal?: NodeJS.Signals | number) {
    this.killSignals.push(signal)
    this.emit("exit", null, signal === "SIGTERM" ? "SIGTERM" : null)
    return true
  }
}

describe("SshControlManager", () => {
  test("resolveSshControlPath matches manager socket path strategy", () => {
    const mgr = new SshControlManager()
    expect(resolveSshControlPath("gpu-3090")).toBe(mgr.getSocketPath("gpu-3090"))
    expect(resolveSshControlPath("ai.consulting")).toBe(mgr.getSocketPath("ai.consulting"))
  })

  test("getSocketPath returns consistent path for same alias", () => {
    const mgr = new SshControlManager()
    const p1 = mgr.getSocketPath("gpu-3090")
    const p2 = mgr.getSocketPath("gpu-3090")
    expect(p1).toBe(p2)
    expect(p1).toContain("gpu-3090")
  })

  test("getSocketPath returns different paths for different aliases", () => {
    const mgr = new SshControlManager()
    const p1 = mgr.getSocketPath("host-a")
    const p2 = mgr.getSocketPath("host-b")
    expect(p1).not.toBe(p2)
  })

  test("getStatus returns offline for unknown host", () => {
    const mgr = new SshControlManager()
    expect(mgr.getStatus("unknown")).toBe("offline")
  })

  test("getStatus returns known values", () => {
    const mgr = new SshControlManager()
    const valid = ["connecting", "connected", "offline"]
    const status = mgr.getStatus("any")
    expect(valid).toContain(status)
  })
})

describe("SshTmuxExecutor", () => {
  test("implements TmuxExecutor interface", () => {
    const mgr = new SshControlManager()
    const exec = new SshTmuxExecutor("gpu-3090", mgr)
    expect(typeof exec.exec).toBe("function")
    expect(typeof exec.execFile).toBe("function")
    expect(typeof exec.spawnAttach).toBe("function")
  })
})

describe("attachWithLocalDetach", () => {
  test("detaches locally on Ctrl+Q without waiting for remote tmux", async () => {
    const stdin = new FakeStdin()
    const stdout = new FakeStdout()
    const child = new FakeChild()

    const attachPromise = attachWithLocalDetach({
      alias: "gpu-3090",
      sessionName: "agentorch_demo",
      socketPath: "/tmp/agent-view.sock",
      tmuxArgs: ["tmux", "-L", "agent-view", "attach-session", "-t", "agentorch_demo"],
      stdin: stdin as never,
      stdout: stdout as never,
      spawnFn: () => child as never,
      pauseMs: () => {}
    })

    stdin.emit("data", Buffer.from([17]))

    await expect(attachPromise).resolves.toBeUndefined()
    expect(child.killSignals).toEqual(["SIGTERM"])
    expect(stdin.rawModes).toEqual([true, false])
  })

  test("throws when ssh exits with an error and user did not detach", async () => {
    const stdin = new FakeStdin()
    const stdout = new FakeStdout()
    const child = new FakeChild()

    const attachPromise = attachWithLocalDetach({
      alias: "gpu-3090",
      sessionName: "agentorch_demo",
      socketPath: "/tmp/agent-view.sock",
      tmuxArgs: ["tmux", "-L", "agent-view", "attach-session", "-t", "agentorch_demo"],
      stdin: stdin as never,
      stdout: stdout as never,
      spawnFn: () => {
        queueMicrotask(() => child.emit("exit", 255, null))
        return child as never
      },
      pauseMs: () => {}
    })

    await expect(attachPromise).rejects.toThrow("Remote attach failed")
    expect(child.killSignals).toEqual([])
    expect(stdin.rawModes).toEqual([true, false])
  })
})
