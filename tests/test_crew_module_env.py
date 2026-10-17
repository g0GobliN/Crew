"""Import-time env pins end with their module (issue #15).

test_crew_coordinator passed alone and failed after test_crew_stop_park: both pinned HERMES_HOME / KANBAN_DB at
import with no module teardown, and kernel_board.open_board re-points HERMES_KANBAN_DB per test, so the module
that ran last left the env on its own scratch board. module_env.pin re-applies a module's pins in setUpModule
and puts every tracked key back in tearDownModule.
"""
import ast
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import module_env  # noqa: E402


class PinTests(unittest.TestCase):
    def setUp(self):
        saved = dict(module_env._PRISTINE)
        self.addCleanup(lambda: (module_env._PRISTINE.clear(), module_env._PRISTINE.update(saved)))
        module_env._PRISTINE.clear()
        p = mock.patch.dict(os.environ, {}, clear=False)
        p.start()
        self.addCleanup(p.stop)
        for k in module_env.TRACKED:
            os.environ.pop(k, None)

    def test_a_later_module_runs_on_its_own_pins_and_leaves_nothing_behind(self):
        a, b = {}, {}
        module_env.pin(a, KANBAN_DB="/a.db", HERMES_HOME="/a")
        module_env.pin(b, KANBAN_DB="/b.db")
        self.assertEqual("/b.db", os.environ["KANBAN_DB"])          # import time: the last import wins
        a["setUpModule"]()
        self.assertEqual(("/a.db", "/a"), (os.environ["KANBAN_DB"], os.environ["HERMES_HOME"]))
        os.environ["HERMES_KANBAN_DB"] = "/a/tmp/kanban.db"            # what kernel_board.open_board does
        a["tearDownModule"]()
        neutral = {k: module_env._PRISTINE[k] for k in module_env.TRACKED}
        self.assertNotIn("/a", (os.environ.get("HERMES_HOME"), os.environ.get("KANBAN_DB")))
        self.assertEqual(neutral["HERMES_KANBAN_DB"], os.environ.get("HERMES_KANBAN_DB"))   # a's per-test board gone
        b["setUpModule"]()
        self.assertEqual("/b.db", os.environ["KANBAN_DB"])
        self.assertEqual(neutral["HERMES_HOME"], os.environ.get("HERMES_HOME"))   # a's home does not reach b
        self.assertEqual(neutral["HERMES_KANBAN_DB"], os.environ.get("HERMES_KANBAN_DB"))

    def test_between_modules_the_env_never_falls_back_to_the_live_home(self):
        live_home = os.path.expanduser("~/.hermes")
        ns = {}
        module_env.pin(ns, KANBAN_DB="/x.db")
        ns["tearDownModule"]()
        home = os.environ.get("HERMES_HOME") or ""
        self.assertTrue(home and os.path.realpath(home) != os.path.realpath(live_home), home)
        self.assertFalse(os.path.exists(os.path.join(home, "kanban.db")))                # an empty home
        for k in ("KANBAN_DB", "HERMES_KANBAN_DB"):
            self.assertFalse(os.path.exists(os.environ[k]), k)                      # a board that is not there

    def test_hermes_bin_stays_pinned_so_no_later_test_starts_the_real_hermes(self):
        ns = {}
        os.environ.pop("HERMES_BIN", None)
        module_env.pin(ns, HERMES_BIN="/bin/false")
        ns["setUpModule"]()
        ns["tearDownModule"]()
        self.assertEqual("/bin/false", os.environ.get("HERMES_BIN"))

    def test_several_pins_in_one_module_add_up(self):
        ns = {}
        module_env.pin(ns, HERMES_HOME="/h")
        module_env.pin(ns, HERMES_KANBAN_DB="/h/k.db")
        module_env.pin(ns, KANBAN_DB="/h/k.db")
        for k in module_env.TRACKED:
            os.environ.pop(k, None)
        ns["setUpModule"]()
        self.assertEqual(("/h", "/h/k.db", "/h/k.db"),
                         (os.environ.get("HERMES_HOME"), os.environ.get("HERMES_KANBAN_DB"), os.environ.get("KANBAN_DB")))

    def test_a_module_level_hook_already_there_is_chained(self):
        calls = []
        ns = {"setUpModule": lambda: calls.append("up"), "tearDownModule": lambda: calls.append("down")}
        module_env.pin(ns, KANBAN_DB="/x.db")
        ns["setUpModule"]()
        ns["tearDownModule"]()
        self.assertEqual(["up", "down"], calls)


class EveryModulePinsThroughTheHelper(unittest.TestCase):
    def test_no_test_module_assigns_os_environ_at_import(self):
        """`os.environ[...] = ...` at module level is the shape that leaked; `setdefault` of HERMES_BIN is fine."""
        offenders = []
        for f in sorted(HERE.glob("test_*.py")):
            tree = ast.parse(f.read_text(encoding="utf-8"))
            for node in tree.body:
                if isinstance(node, ast.Assign) and any(
                        isinstance(t, ast.Subscript) and ast.unparse(t.value) == "os.environ" for t in node.targets):
                    offenders.append("%s:%d" % (f.name, node.lineno))
        self.assertEqual([], offenders, "use module_env.pin(globals(), KEY=value)")


if __name__ == "__main__":
    unittest.main()
