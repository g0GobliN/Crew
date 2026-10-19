"""desktop/plugin.js (the Hermes Desktop page, generated from ui/src by ui/build.mjs): syntax, freshness against its
source, Desktop's own lint, the 512 KiB cap, and the page and pane rendered under node with a stub SDK.
See tests/desktop_plugin_harness.mjs."""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
NODE = shutil.which("node")
HAVE_MODULES = os.path.isdir(os.path.join(ROOT, "ui", "node_modules"))
# A missing ui/node_modules may only skip on a developer machine or the published tree; CI must never skip silently.
NEEDS_MODULES = unittest.skipUnless(
    HAVE_MODULES or os.environ.get("CI"), "ui/node_modules is missing (run `npm ci --prefix ui`); CI never skips")


@unittest.skipUnless(NODE, "node is not installed")
class DesktopPluginTests(unittest.TestCase):
    def test_plugin_js_syntax(self):
        subprocess.run([NODE, "--check", os.path.join(ROOT, "desktop", "plugin.js")], check=True, timeout=30)

    @NEEDS_MODULES
    def test_generated_files_are_current(self):
        build = os.path.join(ROOT, "ui", "build.mjs")
        if not os.path.isfile(build):
            self.skipTest("ui/ is not part of this tree")
        r = subprocess.run([NODE, build, "--check"], capture_output=True, text=True, timeout=120,
                           encoding="utf-8", errors="replace")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    @NEEDS_MODULES
    def test_plugin_js_under_the_stub_sdk(self):
        with tempfile.TemporaryDirectory(prefix="crew-desktop-plugin-") as tmp:
            r = subprocess.run([NODE, os.path.join(HERE, "desktop_plugin_harness.mjs"),
                                os.path.join(ROOT, "desktop", "plugin.js"), tmp],
                               capture_output=True, text=True, timeout=60, encoding="utf-8", errors="replace")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertRegex(r.stdout, r"OK \d+ checks")

    @NEEDS_MODULES
    def test_app_js_in_the_browser_shell_and_the_dashboard_tab(self):
        """scripts/crew_dashboard/app.js (the standalone shell's script and the tab's) under jsdom: route from the
        address bar, history, a hosted mount with a base and a fetch, an exported snapshot, and the dashboard tab
        (dashboard/dist/index.js) mounting it through a stub SDK. tests/browser_app_harness.mjs"""
        r = subprocess.run([NODE, os.path.join(HERE, "browser_app_harness.mjs"),
                            os.path.join(ROOT, "scripts", "crew_dashboard", "app.js"),
                            os.path.join(ROOT, "dashboard", "dist", "index.js")],
                           capture_output=True, text=True, timeout=120, encoding="utf-8", errors="replace")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertRegex(r.stdout, r"OK \d+ checks")

    def test_plugin_js_under_the_desktop_size_cap(self):
        self.assertLess(os.path.getsize(os.path.join(ROOT, "desktop", "plugin.js")), 512 * 1024)

    def test_desktop_surface_lint_is_clean(self):
        hermes = os.path.expanduser("~/.hermes/hermes-agent")
        if not os.path.isdir(hermes):
            hermes = os.environ.get("HERMES_AGENT_DIR", "")
        if hermes:
            sys.path.insert(0, hermes)
        try:
            from hermes_cli.plugin_validate_desktop import desktop_surface_hits
        except ImportError:
            self.skipTest("hermes_cli.plugin_validate_desktop is not importable")
        finally:
            if hermes and sys.path and sys.path[0] == hermes:
                sys.path.pop(0)
        self.assertEqual(desktop_surface_hits(Path(ROOT)), [])

    def test_install_ships_the_desktop_half(self):
        with open(os.path.join(ROOT, "install.py"), encoding="utf-8") as fh:
            src = fh.read()
        self.assertRegex(src, r'(?s)PLUGIN_FILES = \(\[.*?"desktop/plugin\.js"')
        # this suite also runs on the published tree, so the file being here is the proof that it ships
        self.assertTrue(os.path.isfile(os.path.join(ROOT, "desktop", "plugin.js")))

if __name__ == "__main__":
    unittest.main()
