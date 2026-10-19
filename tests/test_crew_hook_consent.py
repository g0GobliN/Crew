#!/usr/bin/env python3
"""The installer's shell-hook consent and profile-parity steps (install.py step_permissions, step_parity).

Every test runs on a temp base home (patched resolve_profile_home / default_home), never the real ~/.hermes.
The rules pinned: crew-shipped and owner-inherited hooks are approved without a prompt; a foreign missing or
drifted hook needs the one block (non-TTY without --approve-hooks: nothing written, exit 1); --check writes
nothing; a profile that lags the package is repaired and re-checked, "not ready" only if it still differs; the entry written is byte-for-byte what
Hermes's own writer writes.
"""
import contextlib
import importlib.util
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

REPO = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("crew_install_consent", str(REPO / "install.py"))
CI = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = CI
spec.loader.exec_module(CI)

HERMES_PY, HERMES_ROOT = CI._hermes_python()      # resolved before a test repoints the default home
SHIPPED_REL = "scripts/crew_signature_gate.py"      # a script the package ships (in PLUGIN_FILES)


def write(path, text, mode=0o755):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Path(path).write_text(text, encoding="utf-8")
    os.chmod(path, mode)


def declare(home, *commands):
    body = "hooks:\n  pre_tool_call:\n" + "".join(
        "    - matcher: terminal\n      command: %s\n      timeout: 10\n" % c for c in commands)
    write(os.path.join(home, "config.yaml"), body, 0o644)


def allowlist(home):
    p = os.path.join(home, CI.ALLOWLIST_NAME)
    return json.loads(Path(p).read_text(encoding="utf-8")) if os.path.exists(p) else None


def seed_entry(home, command, approved_mtime):
    """An approval Hermes recorded earlier, with the script mtime it saw then."""
    data = allowlist(home) or {"approvals": []}
    data["approvals"].append({"event": "pre_tool_call", "command": command, "approved_at": "2026-09-28T21:30:03.224255Z",
                              "script_mtime_at_approval": approved_mtime})
    write(os.path.join(home, CI.ALLOWLIST_NAME), json.dumps(data, indent=2, sort_keys=True), 0o600)


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="crew-consent-unit-")
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.base = os.path.join(self.tmp, "hermes")
        self.owner = os.path.join(self.base, "profiles", "owner")
        self.worker = os.path.join(self.base, "profiles", "crew-worker")
        for home in (self.owner, self.worker):
            os.makedirs(home)
        saved = (CI.resolve_profile_home, CI.crew_card.default_home, CI._confirm_block)
        self.addCleanup(lambda: (setattr(CI, "resolve_profile_home", saved[0]),
                                 setattr(CI.crew_card, "default_home", saved[1]),
                                 setattr(CI, "_confirm_block", saved[2])))
        CI.resolve_profile_home = lambda name: os.path.join(self.base, "profiles", name)
        CI.crew_card.default_home = lambda: self.base
        CI._confirm_block = lambda: None                      # no terminal unless a test says otherwise
        self.foreign = os.path.join(self.tmp, "agent-hooks", "block-windows-paths.py")
        write(self.foreign, "#!/usr/bin/env python3\nprint('{}')\n")

    def shipped(self, home):
        """A hook script that is the package's own file, installed into the profile's plugin copy."""
        dst = os.path.join(home, "plugins", "crew", *SHIPPED_REL.split("/"))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(REPO / SHIPPED_REL, dst)
        os.chmod(dst, 0o755)
        return dst

    def step(self, apply=True, approve_hooks=False):
        with contextlib.redirect_stdout(io.StringIO()) as out:
            status, detail = CI.step_permissions(self.owner, "owner", "crew-", apply, approve_hooks)
        return status, detail, out.getvalue()


class ConsentTests(Base):
    def test_a_crew_shipped_hook_is_approved_without_a_prompt(self):
        script = self.shipped(self.owner)
        declare(self.owner, script)
        status, detail, _ = self.step()
        self.assertEqual("OK", status, detail)
        entry = allowlist(self.owner)["approvals"][0]
        self.assertEqual(["approved_at", "command", "event", "script_mtime_at_approval"], sorted(entry))
        self.assertEqual((script, "pre_tool_call"), (entry["command"], entry["event"]))
        self.assertEqual(CI._mtime_iso(script), entry["script_mtime_at_approval"])

    def test_a_copy_of_a_shipped_script_that_was_edited_is_not_crew_shipped(self):
        script = self.shipped(self.owner)
        Path(script).write_text("#!/usr/bin/env python3\n# edited\n", encoding="utf-8")
        declare(self.owner, script)
        status, detail, out = self.step()
        self.assertEqual("FAILED", status)
        self.assertIn("--approve-hooks", detail)
        self.assertIsNone(allowlist(self.owner))

    def test_a_role_profile_inherits_a_current_owner_approval(self):
        declare(self.owner, self.foreign)
        declare(self.worker, self.foreign)
        seed_entry(self.owner, self.foreign, CI._mtime_iso(self.foreign))
        status, detail, _ = self.step()
        self.assertEqual("OK", status, detail)
        entry = allowlist(self.worker)["approvals"][0]
        self.assertEqual(self.foreign, entry["command"])
        self.assertEqual(CI._mtime_iso(self.foreign), entry["script_mtime_at_approval"])

    def test_a_drifted_foreign_hook_without_a_terminal_or_the_flag_writes_nothing_and_fails(self):
        declare(self.owner, self.foreign)
        seed_entry(self.owner, self.foreign, "2026-09-22T17:10:43.330120Z")     # the script was modified later
        before = (Path(self.owner) / CI.ALLOWLIST_NAME).read_bytes()
        status, detail, out = self.step()
        self.assertEqual("FAILED", status)
        self.assertIn("--approve-hooks", detail)
        self.assertEqual(before, (Path(self.owner) / CI.ALLOWLIST_NAME).read_bytes())
        self.assertIn("owner | pre_tool_call | %s" % self.foreign, out)
        self.assertIn("approved 2026-09-28T21:30:03.224255Z vs script modified", out)

    def test_the_flag_replaces_the_stale_entry_with_the_current_mtime(self):
        declare(self.owner, self.foreign)
        declare(self.worker, self.foreign)
        seed_entry(self.owner, self.foreign, "2026-09-22T17:10:43.330120Z")
        status, detail, out = self.step(approve_hooks=True)
        self.assertEqual("OK", status, detail)
        entries = allowlist(self.owner)["approvals"]
        self.assertEqual(1, len(entries), entries)                               # replaced, not appended
        self.assertEqual(CI._mtime_iso(self.foreign), entries[0]["script_mtime_at_approval"])
        self.assertEqual(1, out.count("shell hooks that need your consent"))       # one block, the role follows the owner
        self.assertEqual(self.foreign, allowlist(self.worker)["approvals"][0]["command"])

    def test_a_terminal_answer_yes_approves_and_no_does_not(self):
        declare(self.owner, self.foreign)
        CI._confirm_block = lambda: False
        self.assertEqual("FAILED", self.step()[0])
        self.assertIsNone(allowlist(self.owner))
        CI._confirm_block = lambda: True
        self.assertEqual("OK", self.step()[0])
        self.assertEqual(1, len(allowlist(self.owner)["approvals"]))

    def test_check_writes_nothing_and_says_what_it_would_do(self):
        script = self.shipped(self.owner)
        declare(self.owner, script, self.foreign)
        status, detail, out = self.step(apply=False, approve_hooks=True)
        self.assertEqual("CHANGED", status)
        self.assertIn("would approve 1 hook(s) without a prompt", detail)
        self.assertIn(self.foreign, detail)
        self.assertEqual("", out)
        self.assertFalse(os.path.exists(os.path.join(self.owner, CI.ALLOWLIST_NAME)))
        self.assertFalse(os.path.exists(os.path.join(self.owner, CI.ALLOWLIST_NAME + ".lock")))

    def test_main_exits_1_and_names_the_flag_when_consent_is_missing(self):
        declare(self.owner, self.foreign)
        saved = (CI._steps, CI.report, CI.h)
        self.addCleanup(lambda: (setattr(CI, "_steps", saved[0]), setattr(CI, "report", saved[1]), setattr(CI, "h", saved[2])))
        CI._steps = lambda home, profile, args: [("permissions", lambda a: CI.step_permissions(
            self.owner, "owner", "crew-", a, args.approve_hooks))]
        CI.report = lambda *a: None
        CI.h = lambda *a: type("R", (), {"stdout": "", "returncode": 0})()
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            sys.argv = ["install.py", "--profile", "owner", "--no-service", "--no-cron"]
            code = CI.main()
        self.assertEqual(1, code)
        self.assertIn("--approve-hooks", out.getvalue())
        self.assertIn("NOT READY: permissions", out.getvalue())
        self.assertIsNone(allowlist(self.owner))
        with contextlib.redirect_stdout(io.StringIO()):
            sys.argv = ["install.py", "--profile", "owner", "--no-service", "--no-cron", "--approve-hooks"]
            self.assertEqual(0, CI.main())


class WriterTests(Base):
    def test_the_entry_is_what_hermes_writes(self):
        py, root = HERMES_PY, HERMES_ROOT
        if not py:
            self.skipTest("no Hermes python on this box")
        theirs = os.path.join(self.tmp, "theirs")
        os.makedirs(theirs)
        code = "import sys; sys.path.insert(0, sys.argv[1]); from agent import shell_hooks as s; s._record_approval('pre_tool_call', sys.argv[2])"
        r = subprocess.run([py, "-c", code, root, self.foreign], env=dict(os.environ, HERMES_HOME=theirs),
                           capture_output=True, text=True, timeout=120)
        if r.returncode:
            self.skipTest("Hermes writer not runnable here: %s" % r.stderr[-200:])
        CI._record_approval(self.owner, "pre_tool_call", self.foreign)
        a, b = allowlist(theirs), allowlist(self.owner)
        for d in (a, b):
            d["approvals"][0]["approved_at"] = "T"
        self.assertEqual(a, b)
        self.assertEqual(oct(os.stat(os.path.join(theirs, CI.ALLOWLIST_NAME)).st_mode & 0o777),
                         oct(os.stat(os.path.join(self.owner, CI.ALLOWLIST_NAME)).st_mode & 0o777))
        # same key order, indent and no trailing newline
        strip = lambda t: json.dumps(json.loads(t), indent=2, sort_keys=True)
        self.assertEqual(strip((Path(theirs) / CI.ALLOWLIST_NAME).read_text()), (Path(theirs) / CI.ALLOWLIST_NAME).read_text())
        self.assertEqual(strip((Path(self.owner) / CI.ALLOWLIST_NAME).read_text()), (Path(self.owner) / CI.ALLOWLIST_NAME).read_text())


class ParityTests(Base):
    def install_copy(self, home):
        for f in (CI.step_plugin, CI.step_skills, CI.step_roles):
            f(home, True)

    def lag(self):
        pyaml = os.path.join(self.worker, "plugins", "crew", "plugin.yaml")
        Path(pyaml).write_text(Path(pyaml).read_text().replace(CI._plugin_version(str(REPO / "plugin.yaml")), "0.0.1", 1))
        Path(os.path.join(self.worker, "plugins", "crew", "__init__.py")).write_text("# old\n")

    def test_a_lagging_profile_is_named_by_check_then_repaired_and_confirmed(self):
        self.install_copy(self.owner)
        self.install_copy(self.worker)
        self.assertEqual("OK", CI.step_parity(self.owner, "crew-", True)[0])
        self.lag()
        status, detail = CI.step_parity(self.owner, "crew-", False)             # --check: report only
        self.assertEqual("CHANGED", status)
        self.assertIn("crew-worker: version 0.0.1", detail)
        self.assertNotIn("owner:", detail)
        self.assertEqual("0.0.1", CI._plugin_version(os.path.join(self.worker, "plugins", "crew", "plugin.yaml")))
        with contextlib.redirect_stdout(io.StringIO()):
            status, detail = CI.step_parity(self.owner, "crew-", True)
        self.assertEqual("CHANGED", status, detail)
        self.assertIn("crew-worker", detail)
        self.assertEqual("OK", CI.step_parity(self.owner, "crew-", False)[0])       # parity holds afterwards

    def test_a_profile_that_cannot_be_repaired_is_not_ready(self):
        self.install_copy(self.owner)
        self.install_copy(self.worker)
        self.lag()
        real = CI.step_plugin
        CI.step_plugin = lambda home, apply: ("OK", "stub")      # the repair writes nothing: stands in for an unwritable dir
        self.addCleanup(setattr, CI, "step_plugin", real)
        with contextlib.redirect_stdout(io.StringIO()):
            status, detail = CI.step_parity(self.owner, "crew-", True)
        self.assertEqual("FAILED", status)
        self.assertIn("crew-worker: version 0.0.1", detail)


if __name__ == "__main__":
    unittest.main()
