#!/usr/bin/env python3
"""The installer's shell-hook consent and profile-parity steps (install.py step_permissions, step_parity).

Every test runs on a temp base home (patched resolve_profile_home / default_home), never the real ~/.hermes.
The rules pinned: the installer never writes shell-hooks-allowlist.json and never passes --accept-hooks, whoever
shipped the hook; one profile's approval is never copied into another; on a terminal it asks per profile whether to
open Hermes's own prompt (yes: revoke drifted entries, then `hermes -p P chat`; no: nothing runs) and --check never
asks; a profile that lags the package is repaired and re-checked, "not ready" only if it still differs.
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
HANDOFF = CI._hermes_consent                       # the real one, before Base patches it

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
        saved = (CI.resolve_profile_home, CI.crew_card.default_home, CI._ask, CI._hermes_consent)
        self.addCleanup(lambda: (setattr(CI, "resolve_profile_home", saved[0]),
                                 setattr(CI.crew_card, "default_home", saved[1]),
                                 setattr(CI, "_ask", saved[2]), setattr(CI, "_hermes_consent", saved[3])))
        CI.resolve_profile_home = lambda name: os.path.join(self.base, "profiles", name)
        CI.crew_card.default_home = lambda: self.base
        self.asked, self.handed = [], []
        self.answer = None                                    # no terminal unless a test says otherwise
        CI._ask = lambda q: (self.asked.append(q), self.answer)[1]
        CI._hermes_consent = lambda name, drift: self.handed.append((name, list(drift)))
        self.foreign = os.path.join(self.tmp, "agent-hooks", "block-windows-paths.py")
        write(self.foreign, "#!/usr/bin/env python3\nprint('{}')\n")

    def shipped(self, home):
        """A hook script that is the package's own file, installed into the profile's plugin copy."""
        dst = os.path.join(home, "plugins", "crew", *SHIPPED_REL.split("/"))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(REPO / SHIPPED_REL, dst)
        os.chmod(dst, 0o755)
        return dst

    def step(self, apply=True):
        with contextlib.redirect_stdout(io.StringIO()) as out:
            status, detail = CI.step_permissions(self.owner, "owner", "crew-", apply)
        return status, detail, out.getvalue()


class ConsentTests(Base):
    def test_a_crew_shipped_hook_is_reported_not_approved(self):
        declare(self.owner, self.shipped(self.owner))
        status, detail, _out = self.step()
        self.assertEqual("FAILED", status)
        self.assertIn("hermes -p owner chat", detail)
        self.assertIsNone(allowlist(self.owner))

    def test_an_owner_approval_is_never_copied_into_a_role_profile(self):
        seed_entry(self.owner, self.foreign, CI._mtime_iso(self.foreign))
        declare(self.owner, self.foreign)
        CI_plans = CI._role_plans
        CI._role_plans = lambda prefix: [("worker", "crew-worker", self.worker, None)]
        self.addCleanup(setattr, CI, "_role_plans", CI_plans)
        declare(self.worker, self.foreign)
        status, detail, _out = self.step()
        self.assertEqual("FAILED", status)
        self.assertIn("crew-worker: declared but not approved", detail)
        self.assertIsNone(allowlist(self.worker))

    def test_no_terminal_asks_nothing_runs_nothing_writes_nothing(self):
        declare(self.owner, self.foreign)
        status, detail, out = self.step()
        self.assertEqual("FAILED", status)
        self.assertEqual([], self.handed)
        self.assertEqual(1, len(self.asked))               # asked once, got None (no terminal)
        self.assertIn("not approved:   [pre_tool_call] %s" % self.foreign, out)
        self.assertIsNone(allowlist(self.owner))

    def test_yes_hands_the_profile_to_hermes_and_no_does_not(self):
        declare(self.owner, self.foreign)
        self.answer = False
        self.step()
        self.assertEqual([], self.handed)
        self.answer = True
        self.step()
        self.assertEqual([("owner", [])], self.handed)
        self.assertIsNone(allowlist(self.owner))           # the installer wrote nothing either way

    def test_a_drifted_entry_is_named_and_passed_on_for_revoke(self):
        seed_entry(self.owner, self.foreign, "2000-01-01T00:00:00Z")
        declare(self.owner, self.foreign)
        before = allowlist(self.owner)
        self.answer = True
        _status, _detail, out = self.step()
        self.assertIn("script changed: [pre_tool_call] %s" % self.foreign, out)
        self.assertEqual([("owner", [("pre_tool_call", self.foreign)])], self.handed)
        self.assertEqual(before, allowlist(self.owner))

    def test_a_current_approval_asks_nothing_and_reads_ok(self):
        seed_entry(self.owner, self.foreign, CI._mtime_iso(self.foreign))
        declare(self.owner, self.foreign)
        status, _detail, _out = self.step()
        self.assertEqual("OK", status)
        self.assertEqual([], self.asked)

    def test_check_never_asks(self):
        declare(self.owner, self.foreign)
        status, detail, _out = self.step(apply=False)
        self.assertEqual("FAILED", status)
        self.assertEqual([], self.asked)
        self.assertIsNone(allowlist(self.owner))


class HermesHandOffTests(Base):
    def test_revoke_then_chat_on_this_terminal_never_accept_hooks(self):
        calls = []
        real = CI.subprocess.run
        CI.subprocess.run = lambda cmd, **kw: calls.append(cmd)
        self.addCleanup(setattr, CI.subprocess, "run", real)
        with contextlib.redirect_stdout(io.StringIO()):
            HANDOFF("crew-worker", [("pre_tool_call", self.foreign)])
        hb = CI.hermes_bin()
        self.assertEqual([[hb, "-p", "crew-worker", "hooks", "revoke", self.foreign],
                          [hb, "-p", "crew-worker", "chat"]], calls)

    def test_the_installer_holds_no_allowlist_writer(self):
        src = (REPO / "install.py").read_text(encoding="utf-8")
        for token in ("_record_approval", "--approve-hooks", "HERMES_ACCEPT_HOOKS", '"--accept-hooks"', ".shell-hooks-allowlist_"):
            self.assertNotIn(token, src)


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
