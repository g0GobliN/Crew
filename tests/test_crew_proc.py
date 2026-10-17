"""crew_proc (liveness, command line, tree kill) and the Windows-facing parts of crew_safety: the proof runs in
Git Bash and never in cmd.exe, a script named by a Windows path is still bound by hash, and the path guards read
backslashes. The Windows branches are pinned here on every OS; the CI Windows job runs the real ones."""
import importlib.util
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "scripts"))
import crew_card  # noqa: E402
import crew_proc  # noqa: E402
import crew_safety  # noqa: E402


class ProcTests(unittest.TestCase):
    def test_this_process_is_alive_and_garbage_pids_are_not(self):
        self.assertTrue(crew_proc.alive(os.getpid()))
        for bad in (None, "x", 0, -5, 99999999):
            self.assertFalse(crew_proc.alive(bad), bad)

    def test_terminate_tree_ends_a_child_and_it_then_reads_dead(self):
        # its own session: the POSIX kill signals the whole process group, which must not be the test runner's
        proc = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"], start_new_session=True)
        try:
            time.sleep(0.3)
            self.assertTrue(crew_proc.alive(proc.pid))
            self.assertTrue(crew_proc.terminate_tree(proc.pid, 0.2))
            self.assertFalse(crew_proc.alive(proc.pid))
        finally:
            proc.kill()
            proc.wait()

    def test_the_command_line_names_the_arguments(self):
        proc = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)", "marker-arg-42"])
        try:
            time.sleep(0.5)
            self.assertIn("marker-arg-42", crew_proc.cmdline_of(proc.pid))
        finally:
            proc.kill()
            proc.wait()


class WindowsProofTests(unittest.TestCase):
    def test_script_paths_are_found_in_posix_and_windows_form(self):
        rx = crew_safety.SCRIPT_RX
        self.assertEqual(["/x/site/.crew/v.py"], rx.findall("python3 /x/site/.crew/v.py"))
        self.assertEqual(["C:/x/.crew/v.py"], rx.findall("python3 C:/x/.crew/v.py"))
        self.assertEqual(["C:\\x\\.crew\\v.py"], rx.findall("python3 C:\\x\\.crew\\v.py"))

    def test_git_bash_is_the_one_next_to_git_never_the_wsl_launcher(self):
        with tempfile.TemporaryDirectory() as tmp:
            cmd_dir = os.path.join(tmp, "Git", "cmd")
            os.makedirs(cmd_dir)
            os.makedirs(os.path.join(tmp, "Git", "bin"))
            Path(cmd_dir, "git.exe").write_text("", encoding="utf-8")
            bash = os.path.join(tmp, "Git", "bin", "bash.exe")
            Path(bash).write_text("", encoding="utf-8")
            # Isolated from the host: on a real Windows Hermes box HERMES_GIT_BASH_PATH and the Hermes home's
            # PortableGit are found first, and the test asserted the host's C:\Program Files\Git instead of its own.
            empty = os.path.join(tmp, "home")
            with mock.patch.dict(os.environ, {"HERMES_GIT_BASH_PATH": ""}), \
                    mock.patch.object(crew_card, "base_home", return_value=empty), \
                    mock.patch.object(crew_card, "default_home", return_value=empty):
                with mock.patch.object(crew_safety.shutil, "which", return_value=os.path.join(cmd_dir, "git.exe")):
                    self.assertEqual(bash, crew_safety.git_bash())
                with mock.patch.object(crew_safety.shutil, "which", return_value=None):
                    self.assertEqual("", crew_safety.git_bash())

    def test_on_windows_a_proof_runs_as_bash_dash_c_and_without_git_bash_it_does_not_run(self):
        seen = []

        def fake_run(argv, **kw):
            if argv and argv[0].endswith("bash.exe"):          # the safety floor's own git/tirith calls pass by
                seen.append((argv, kw.get("shell")))
            return mock.Mock(returncode=0, stdout="ok", stderr="")
        with mock.patch.object(crew_safety, "IS_WINDOWS", True), \
                mock.patch.object(crew_safety.subprocess, "run", fake_run):
            with mock.patch.object(crew_safety, "git_bash", return_value="/g/bin/bash.exe"):
                res = crew_safety.run_proof("echo hi", None, 5, "safe")
            self.assertEqual(([["/g/bin/bash.exe", "-c", "echo hi"]], 0, False),
                             ([s[0] for s in seen], res.rc, seen[0][1]))
            seen.clear()
            with mock.patch.object(crew_safety, "git_bash", return_value=""):
                res = crew_safety.run_proof("echo hi", None, 5, "safe")
            self.assertEqual((127, []), (res.rc, seen))
            self.assertIn("Git Bash", res.out)

    def test_a_git_bash_style_drive_path_is_still_hashed(self):
        with mock.patch.object(crew_safety, "IS_WINDOWS", True):
            self.assertEqual("C:/Users/x/v.py", crew_safety._script_file("/c/Users/x/v.py"))
        with mock.patch.object(crew_safety, "IS_WINDOWS", False):
            self.assertEqual("/c/Users/x/v.py", crew_safety._script_file("/c/Users/x/v.py"))


class GuardPathTests(unittest.TestCase):
    def test_backslash_paths_meet_the_same_guards_as_slash_paths(self):
        spec = importlib.util.spec_from_file_location("crew_plugin_guardpaths", str(REPO / "__init__.py"))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        args = {"path": "C:\\Users\\x\\profiles\\crew-coordinator\\config.yaml", "content": "approvals:\n  mode: off\n"}
        self.assertTrue(mod._crew_config_write_attempt("write_file", args))
        self.assertTrue(mod._only_crew_dir({"path": "C:\\site\\.crew\\verify.py"}))
        self.assertFalse(mod._only_crew_dir({"path": "C:\\site\\index.html"}))


if __name__ == "__main__":
    unittest.main()
