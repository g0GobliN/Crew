"""Every temp dir a test makes lives under one session sandbox that is removed when the run ends, pass or fail.

Many tests make their own scratch with tempfile.mkdtemp and never remove it; with TMPDIR (and tempfile.tempdir)
pointed at a single throwaway folder, all of them land there and the folder goes at session end. Child processes
the tests start inherit TMPDIR, so their scratch goes there too. Created at conftest import, so module-level
mkdtemp calls made during collection are covered as well."""
import atexit
import os
import shutil
import tempfile

_SANDBOX = tempfile.mkdtemp(prefix="crew-pytest-sandbox-")
os.environ["TMPDIR"] = _SANDBOX
tempfile.tempdir = _SANDBOX


def _cleanup():
    shutil.rmtree(_SANDBOX, ignore_errors=True)


def pytest_sessionfinish(session, exitstatus):
    _cleanup()


atexit.register(_cleanup)
