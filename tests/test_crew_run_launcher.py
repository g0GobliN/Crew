"""scripts/crew-run.sh is how an agent starts a crew script on every OS: no skill may name `python3`, and the
launcher must find an interpreter without it."""
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
LAUNCHER = REPO / "scripts" / "crew-run.sh"


class LauncherTests(unittest.TestCase):
    def test_no_skill_or_hint_tells_an_agent_to_run_python3(self):
        for path in list((REPO / "skills").glob("*/SKILL.md")) + [REPO / "roles" / "roles.json"] + list((REPO / "roles" / "briefs").glob("*.md")):
            self.assertNotRegex(path.read_text(encoding="utf-8"), r"\bpython3\b", str(path))
        code = (REPO / "__init__.py").read_text(encoding="utf-8")
        self.assertIsNone(re.search(r'python3 \\?"\$HERMES_HOME', code))

    @unittest.skipUnless(os.name != "nt" and shutil.which("sh"), "POSIX sh")
    def test_launcher_runs_a_crew_script_with_python_off_path_via_crew_python(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {"PATH": "/nonexistent", "HERMES_HOME": tmp, "CREW_PYTHON": sys.executable}
            done = subprocess.run(["/bin/sh", str(LAUNCHER), "crew_card.py", "safety"], capture_output=True, text=True,
                                  env=env, timeout=120)
            self.assertEqual(0, done.returncode, done.stderr)
            self.assertIn(done.stdout.strip().splitlines()[-1], ("safe", "brave"))

    @unittest.skipUnless(os.name != "nt" and shutil.which("sh"), "POSIX sh")
    def test_launcher_says_so_when_there_is_no_python(self):
        with tempfile.TemporaryDirectory() as tmp:
            done = subprocess.run(["/bin/sh", str(LAUNCHER), "crew_card.py", "safety"], capture_output=True, text=True,
                                  env={"PATH": "/nonexistent", "HERMES_HOME": tmp}, timeout=60)
            self.assertEqual(127, done.returncode)
            self.assertIn("no Python 3 found", done.stderr)


if __name__ == "__main__":
    unittest.main()
