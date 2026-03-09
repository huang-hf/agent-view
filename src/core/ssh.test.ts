import { describe, test, expect } from "bun:test"
import { SshControlManager, SshTmuxExecutor } from "./ssh"

describe("SshControlManager", () => {
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
