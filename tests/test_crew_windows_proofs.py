"""Two proof-suite faults from native Windows 11 (issue #15), checked on any OS.

1. crew_role_platforms_proof.gateway_identity() ran `systemctl` unguarded: FileNotFoundError [WinError 2] on a
   box with no systemd once a gateway_state.json existed.
2. crew_proofs ran every proof with the parent's env, so on Windows a proof's stdout to the runner's pipe was
   cp1252 and a box-drawing character killed it with UnicodeEncodeError.
"""
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "scripts"))
os.environ.setdefault("HERMES_BIN", "/bin/false")

import crew_proofs  # noqa: E402
import crew_role_platforms_proof as rp  # noqa: E402


class GatewayIdentityTests(unittest.TestCase):
    def test_no_systemctl_means_no_gateway_and_no_process_is_started(self):
        with mock.patch.object(rp.shutil, "which", return_value=None), \
                mock.patch.object(rp, "run", side_effect=FileNotFoundError(2, "WinError 2")) as run:
            self.assertEqual((0, None), rp.gateway_identity())
        run.assert_not_called()


class ChildEnvTests(unittest.TestCase):
    def test_every_proof_writes_utf8_to_the_runner(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("PYTHONIOENCODING", None)
            names = ["crew_route_pin_proof.py"] + sorted(crew_proofs.LIVE_BOARD)[:1] + sorted(crew_proofs.LIVE_READERS)[:1]
            for name in names:
                self.assertEqual("utf-8", crew_proofs.child_env(name).get("PYTHONIOENCODING"), name)

    def test_a_callers_own_encoding_wins(self):
        with mock.patch.dict(os.environ, {"PYTHONIOENCODING": "utf-16"}):
            self.assertEqual("utf-16", crew_proofs.child_env("crew_route_pin_proof.py")["PYTHONIOENCODING"])


if __name__ == "__main__":
    unittest.main()
