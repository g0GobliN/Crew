"""desktop/plugin.js (the Hermes Desktop page) under node with stubbed SDK modules: registration, the request
allowlist, the sender check, the page handed to the sandboxed frame. See tests/desktop_plugin_harness.mjs."""
import os
import shutil
import subprocess
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
NODE = shutil.which("node")


@unittest.skipUnless(NODE, "node is not installed")
class DesktopPluginTests(unittest.TestCase):
    def test_plugin_js_syntax(self):
        subprocess.run([NODE, "--check", os.path.join(ROOT, "desktop", "plugin.js")], check=True, timeout=30)

    def test_plugin_js_under_the_stub_sdk(self):
        with tempfile.TemporaryDirectory(prefix="crew-desktop-plugin-") as tmp:
            r = subprocess.run([NODE, os.path.join(HERE, "desktop_plugin_harness.mjs"),
                                os.path.join(ROOT, "desktop", "plugin.js"), tmp],
                               capture_output=True, text=True, timeout=60, encoding="utf-8", errors="replace")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertRegex(r.stdout, r"OK \d+ checks")

    def test_install_ships_the_desktop_half(self):
        with open(os.path.join(ROOT, "install.py"), encoding="utf-8") as fh:
            src = fh.read()
        self.assertRegex(src, r'(?s)PLUGIN_FILES = \(\[.*?"desktop/plugin\.js"')
        # this suite also runs on the published tree, so the file being here is the proof that it ships
        self.assertTrue(os.path.isfile(os.path.join(ROOT, "desktop", "plugin.js")))

if __name__ == "__main__":
    unittest.main()
