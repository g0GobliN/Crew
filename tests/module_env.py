"""Module-scoped environment pins for the unit tests, so one module's env cannot outlive it.

A test module that points HERMES_HOME / KANBAN_DB / HERMES_KANBAN_DB at its own scratch dir has to do it
BEFORE it imports the scripts (several read the env at import), so the write happens at import time. But
unittest imports every module first and runs them later, and `kernel_board.open_board` re-points
HERMES_KANBAN_DB per test - so without a reset, whichever module wrote last wins, and a later module reads
another module's board (issue #15: test_crew_coordinator passed alone and failed after test_crew_stop_park).

    import module_env
    module_env.pin(globals(), HERMES_HOME=..., KANBAN_DB=...)

`pin` applies the values now (import time, as before) and installs setUpModule / tearDownModule:
  setUpModule    - every tracked key back to its neutral value (an empty scratch home, a board file that
                   does not exist - never the live ones), then this module's pins on top: the module runs on
                   its own env whatever ran before it.
  tearDownModule - every tracked key back to that neutral value: nothing it set, or a helper set for it,
                   leaks into the next module, and nothing after it falls through to the live home.
Several `pin` calls in one module add up to one set of pins.
"""
import os
import sys
import tempfile
import types

# Keys a test or a helper may set without pinning them itself (open_board sets HERMES_KANBAN_DB).
TRACKED = ("HERMES_HOME", "HERMES_KANBAN_DB", "HERMES_KANBAN_BOARD", "KANBAN_DB")
# Applied, never restored: HERMES_BIN=/bin/false keeps every later test from starting the real `hermes`
# (under a scratch HERMES_HOME it bootstraps a runtime and rewrites the live launcher). Undoing it would
# re-arm that for the modules that only `setdefault` it at import.
STICKY = ("HERMES_BIN",)

# One pristine record per process, even when this file is imported twice (`module_env` and
# `tests.module_env` are two module objects): a second copy would remember the first module's pins as pristine.
_PRISTINE = sys.modules.setdefault("_crew_module_env_pristine", types.SimpleNamespace(values={})).values

_PINS = "_module_env_pins"


def _remember(keys):
    """The value a tracked key goes back to between modules: never the live one. Before this helper the
    leaked env of whichever module imported last happened to be a scratch home, and tests written since
    rely on that (a status read that must see no board, a launcher run that must find no python): handed
    the real HERMES_HOME back they read the owner's live board and pass or fail with what is on it
    (publish gate, 2026-10-17). So the neutral value is an empty scratch home and a board file that does
    not exist; a test that needs a key unset says so itself (mock.patch.dict)."""
    for k in keys:
        if k not in _PRISTINE:
            _PRISTINE[k] = _neutral(k)


def _neutral(key):
    root = sys.modules.setdefault("_crew_module_env_scratch", types.SimpleNamespace(
        path=tempfile.mkdtemp(prefix="crew-test-neutral-"))).path
    if key == "HERMES_HOME":
        return os.path.join(root, "home")
    if key in ("HERMES_KANBAN_DB", "KANBAN_DB"):
        return os.path.join(root, "no-board", "kanban.db")
    return None


def restore():
    """Every tracked key back to its neutral value (see _remember)."""
    for k, v in _PRISTINE.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v


def _apply(env):
    for k, v in env.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v


def pin(namespace, **env):
    """Apply `env` now and give the calling module setUpModule/tearDownModule that re-apply and undo it.

    A value of None means "unset for this module". A setUpModule/tearDownModule the module defined before
    its first pin is kept and chained (ours runs first on setup, last on teardown)."""
    _remember(TRACKED)
    _remember(k for k in env if k not in STICKY)
    _apply(env)
    if _PINS in namespace:                       # a second pin in the same module: same hooks, more keys
        namespace[_PINS].update(env)
        return
    pins = namespace[_PINS] = dict(env)
    prev_setup = namespace.get("setUpModule")
    prev_teardown = namespace.get("tearDownModule")

    def setUpModule():
        restore()
        _apply(pins)
        if prev_setup:
            prev_setup()

    def tearDownModule():
        try:
            if prev_teardown:
                prev_teardown()
        finally:
            restore()

    namespace["setUpModule"] = setUpModule
    namespace["tearDownModule"] = tearDownModule
