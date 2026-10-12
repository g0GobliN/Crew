"""Where a native Windows Hermes keeps things, and crew finding them: the venv python (Scripts\\python.exe), the venv
site-packages (Lib\\site-packages), the default home (%LOCALAPPDATA%\\hermes), the Hermes source beside that home, and
the Git Bash Hermes installs for itself. Fake trees only; the Windows branch is pinned by crew_card.IS_WINDOWS, so
these run on Linux. tests/e2e/windows_native.py is the same set against a real Windows install."""
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "scripts"))
os.environ.setdefault("HERMES_BIN", "/bin/false")

import crew_card  # noqa: E402
import crew_safety  # noqa: E402


def touch(path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("", encoding="utf-8")
    return str(path)


class Layout(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def test_windows_venv_python_is_scripts_python_exe(self):
        venv = self.root / "venv"
        want = touch(venv / "Scripts" / "python.exe")
        touch(venv / "bin" / "python")
        with mock.patch.object(crew_card, "IS_WINDOWS", True):
            self.assertEqual(want, crew_card.venv_python(venv))

    def test_posix_venv_python_is_bin_python(self):
        venv = self.root / "venv"
        touch(venv / "Scripts" / "python.exe")
        want = touch(venv / "bin" / "python")
        with mock.patch.object(crew_card, "IS_WINDOWS", False):
            self.assertEqual(want, crew_card.venv_python(venv))

    def test_a_venv_of_the_other_os_is_not_found(self):
        venv = self.root / "venv"
        touch(venv / "bin" / "python")
        with mock.patch.object(crew_card, "IS_WINDOWS", True):
            self.assertEqual("", crew_card.venv_python(venv))

    def test_hermes_python_finds_a_windows_in_tree_venv(self):
        agent = self.root / "hermes-agent"
        want = touch(agent / "venv" / "Scripts" / "python.exe")
        with mock.patch.object(crew_card, "IS_WINDOWS", True):
            self.assertEqual(want, crew_card.hermes_python(str(agent)))

    def test_site_packages_per_os(self):
        venv = self.root / "venv"
        (venv / "Lib" / "site-packages").mkdir(parents=True)
        (venv / "lib" / "python3.12" / "site-packages").mkdir(parents=True)
        with mock.patch.object(crew_card, "IS_WINDOWS", True):
            self.assertEqual([str(venv / "Lib" / "site-packages")], crew_card.venv_site_packages(venv))
        with mock.patch.object(crew_card, "IS_WINDOWS", False):
            self.assertEqual([str(venv / "lib" / "python3.12" / "site-packages")], crew_card.venv_site_packages(venv))

    def test_default_home_is_localappdata_hermes_on_windows(self):
        with mock.patch.object(crew_card, "IS_WINDOWS", True), \
             mock.patch.dict(os.environ, {"LOCALAPPDATA": str(self.root)}):
            self.assertEqual(str(self.root / "hermes"), crew_card.default_home())

    def test_hermes_root_sits_beside_a_profile_home_on_windows(self):
        agent = self.root / "hermes" / "hermes-agent"
        agent.mkdir(parents=True)
        prof = self.root / "hermes" / "profiles" / "p"
        env = {"HERMES_HOME": str(prof), "LOCALAPPDATA": str(self.root)}
        with mock.patch.object(crew_card, "IS_WINDOWS", True), mock.patch.dict(os.environ, env):
            os.environ.pop("HERMES_AGENT_DIR", None)
            os.environ.pop("HERMES_SRC", None)
            self.assertEqual(str(agent), crew_card.hermes_root())

    def test_git_bash_prefers_the_portable_git_hermes_installs(self):
        bash = touch(self.root / "hermes" / "git" / "bin" / "bash.exe")
        env = {"HERMES_HOME": str(self.root / "hermes"), "LOCALAPPDATA": str(self.root)}
        with mock.patch.object(crew_card, "IS_WINDOWS", True), mock.patch.dict(os.environ, env), \
             mock.patch.object(crew_safety.shutil, "which", return_value=None):
            os.environ.pop("HERMES_GIT_BASH_PATH", None)
            self.assertEqual(bash, crew_safety.git_bash())

    def test_git_bash_honours_hermes_git_bash_path(self):
        bash = touch(self.root / "elsewhere" / "bash.exe")
        with mock.patch.dict(os.environ, {"HERMES_GIT_BASH_PATH": bash}):
            self.assertEqual(bash, crew_safety.git_bash())


if __name__ == "__main__":
    unittest.main()
