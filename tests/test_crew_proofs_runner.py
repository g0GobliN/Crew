"""The proof runner's scheduling: the serial lane, the isolated pool, the order of results and the timeouts."""
import os
import sys
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import crew_proofs  # noqa: E402


class RunAllTest(unittest.TestCase):
    def fake(self, log, lock, active):
        def run_one(name, timeout, extra=()):
            with lock:
                active.append(name)
                log.append(("start", name, tuple(active)))
            time.sleep(0.05)
            with lock:
                active.remove(name)
            return {"file": name, "rc": 0, "seconds": 0.05, "tail": ""}
        return run_one

    def test_results_come_back_in_picked_order_for_any_jobs(self):
        picked = ["crew_brief_proof.py", "crew_heal_proof.py", "crew_stop_proof.py", "crew_notify_proof.py"]
        for jobs in (1, 4):
            log, lock = [], threading.Lock()
            with mock.patch.object(crew_proofs, "run_one", self.fake(log, lock, [])):
                got = [r["file"] for r in crew_proofs.run_all(picked, 5, jobs, "")]
            self.assertEqual(picked, got, jobs)

    def test_shared_board_proofs_never_overlap_but_isolated_ones_run_beside_them(self):
        lane = ["crew_brief_proof.py", "crew_stop_proof.py", "crew_attention_proof.py"]
        iso = ["crew_heal_proof.py", "crew_notify_proof.py", "crew_probe_skip_proof.py"]
        self.assertFalse(set(lane) & crew_proofs.ISOLATED)
        self.assertTrue(set(iso) <= crew_proofs.ISOLATED)
        log, lock = [], threading.Lock()
        with mock.patch.object(crew_proofs, "run_one", self.fake(log, lock, [])):
            crew_proofs.run_all(lane + iso, 5, 4, "")
        for _, name, active in log:
            if name in lane:
                self.assertEqual([name], [a for a in active if a in lane], "two shared-board proofs overlapped")
        self.assertTrue(any(len([a for a in active if a in iso]) > 1 or
                            (name in iso and any(a in lane for a in active)) for _, name, active in log),
                        "nothing ran in parallel")

    def test_jobs_1_is_strictly_serial(self):
        picked = ["crew_heal_proof.py", "crew_notify_proof.py", "crew_brief_proof.py"]
        log, lock = [], threading.Lock()
        with mock.patch.object(crew_proofs, "run_one", self.fake(log, lock, [])):
            crew_proofs.run_all(picked, 5, 1, "")
        self.assertTrue(all(len(active) == 1 for _, _, active in log))

    def test_card_is_passed_only_to_the_proofs_that_take_one(self):
        seen = {}

        def run_one(name, timeout, extra=()):
            seen[name] = list(extra)
            return {"file": name, "rc": 0, "seconds": 0, "tail": ""}
        with mock.patch.object(crew_proofs, "run_one", run_one):
            crew_proofs.run_all(["crew_panel_click_check.py", "crew_heal_proof.py"], 5, 2, "t_x")
        self.assertEqual(["--card", "t_x"], seen["crew_panel_click_check.py"])
        self.assertEqual([], seen["crew_heal_proof.py"])

    def test_a_slow_proof_gets_its_own_ceiling_but_never_a_lower_one(self):
        got = []

        def fake_run(cmd, **kw):
            got.append(kw["timeout"])
            return mock.Mock(stdout="", stderr="", returncode=0)
        with mock.patch.object(crew_proofs.subprocess, "run", fake_run):
            crew_proofs.run_one("crew_coordinator_proof.py", 600)
            crew_proofs.run_one("crew_heal_proof.py", 600)
            crew_proofs.run_one("crew_coordinator_proof.py", 5000)
        self.assertEqual([1800, 600, 5000], got)

    def test_default_jobs_is_between_two_and_four(self):
        for cores in (1, 4, 8, 64, None):
            with mock.patch.object(crew_proofs.os, "cpu_count", return_value=cores):
                self.assertTrue(2 <= crew_proofs.default_jobs() <= 4, cores)

    def test_every_isolated_name_is_a_real_proof(self):
        # Every isolated name must be one candidates() would pick up. The strict "and it exists" check runs only in
        # the dev checkout: the shipped plugin omits some proofs (dev/publish.py EXCLUDE, e.g. the route-floor proof).
        for name in crew_proofs.ISOLATED:
            self.assertRegex(name, r"(_proof|_check|signature_gate)\.py$")
        if (Path(__file__).resolve().parent.parent / "dev" / "publish.py").exists():
            self.assertEqual(set(), crew_proofs.ISOLATED - set(crew_proofs.candidates()))


if __name__ == "__main__":
    unittest.main()
