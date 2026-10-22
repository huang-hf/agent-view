import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest

PLUGIN = os.path.join(os.path.dirname(os.path.abspath(__file__)), "agent-view.3s.py")


class PluginTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name
        self.log = os.path.join(self.dir, "swiftbar.log")
        self.config = os.path.join(self.dir, "config.json")
        self.av = os.path.join(self.dir, "fake-av")

    def tearDown(self):
        self.tmp.cleanup()

    def fake_av(self, body):
        with open(self.av, "w") as f:
            f.write("#!/bin/sh\n" + body + "\n")
        os.chmod(self.av, os.stat(self.av).st_mode | stat.S_IXUSR)

    def run_plugin(self):
        env = dict(os.environ)
        env.update(
            AV_SWIFTBAR_LOG=self.log,
            AV_SWIFTBAR_AV=self.av,
            AV_SWIFTBAR_CONFIG=self.config,
        )
        p = subprocess.run([sys.executable, "-B", PLUGIN], env=env, capture_output=True, text=True, timeout=20)
        self.assertEqual(p.returncode, 0, p.stderr)
        return p.stdout

    def read_log(self):
        with open(self.log) as f:
            return f.read()

    def write_config(self, ids):
        with open(self.config, "w") as f:
            json.dump({"currentSessionIds": ids}, f)

    def sessions_av(self, sessions):
        self.fake_av("cat <<'EOF'\n" + json.dumps(sessions) + "\nEOF")

    def test_av_failure_shows_warning_and_logs_error(self):
        self.fake_av("echo boom >&2; exit 1")
        out = self.run_plugin()
        self.assertTrue(out.splitlines()[0].startswith("⚠️ av"))
        self.assertIn("boom", out)
        self.assertIn("error", self.read_log())

    def test_empty_stdout_shows_warning(self):
        self.fake_av("exit 0")
        out = self.run_plugin()
        self.assertTrue(out.splitlines()[0].startswith("⚠️ av"))

    def test_idle_current_session(self):
        self.sessions_av([{"id": "a", "title": "t", "status": "idle"}])
        self.write_config(["a"])
        out = self.run_plugin()
        self.assertEqual(out.splitlines()[0], "○1")
        log = self.read_log()
        self.assertIn("ok", log)
        self.assertIn("cur=1", log)

    def test_invalid_config_shows_warning(self):
        self.sessions_av([{"id": "a", "title": "t", "status": "idle"}])
        with open(self.config, "w") as f:
            f.write('{"currentSessionIds": ["a"')
        out = self.run_plugin()
        self.assertTrue(out.splitlines()[0].startswith("⚠️ av"))
        self.assertIn("config", out)

    def test_missing_config_is_empty_current(self):
        self.sessions_av([{"id": "a", "title": "t", "status": "idle"}])
        out = self.run_plugin()
        self.assertEqual(out.splitlines()[0], "◌")

    def test_idle_with_note_is_blocked(self):
        self.sessions_av([{"id": "a", "title": "t", "status": "idle", "note": "waiting on X"}])
        self.write_config(["a"])
        out = self.run_plugin()
        self.assertEqual(out.splitlines()[0], "⧗1")

    def test_log_is_trimmed(self):
        self.sessions_av([])
        with open(self.log, "w") as f:
            f.write("old\n" * 1000)
        self.run_plugin()
        with open(self.log) as f:
            n = len(f.readlines())
        self.assertEqual(n, 500)


if __name__ == "__main__":
    unittest.main()
