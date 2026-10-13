"""A proof that seeds fixture cards must never give them an assignee the dispatcher can claim.

Measured 2026-09-30: fixtures seeded 'ready' with assignee crew-worker started 20 real crew-worker sessions
in 20 minutes. crew_card.FIXTURE_ASSIGNEE is no Hermes profile, so the dispatcher skips the card. This reads
every proof's source, so a new proof that seeds `tasks` with a real assignee fails here, not on someone's board.
"""
import glob
import os
import re
import unittest

SCRIPTS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts")

# diagnose builds a scratch database of its own (no dispatcher reads it); route_floor is not shipped and
# seeds real assignees on purpose to prove the model floor.
ALLOWED = {"crew_diagnose_proof.py", "crew_route_floor_proof.py"}


class ProofFixtureTests(unittest.TestCase):
    def proofs_that_seed_tasks(self):
        for path in sorted(glob.glob(os.path.join(SCRIPTS, "crew_*_proof.py"))):
            with open(path, encoding="utf-8") as fh:
                src = fh.read()
            if re.search(r"insert into tasks", src, re.I):
                yield os.path.basename(path), src

    def test_every_proof_seeds_its_cards_with_the_fixture_assignee(self):
        seen = 0
        for name, src in self.proofs_that_seed_tasks():
            if name in ALLOWED:
                continue
            seen += 1
            with self.subTest(proof=name):
                self.assertTrue("FIXTURE_ASSIGNEE" in src or "crew-probe" in src, "no fixture assignee")
                for m in re.finditer(r"insert into tasks\b.*?values[\s\"']*\((.*?)\)", src, re.I | re.S):
                    self.assertNotIn("crew-worker", m.group(1), "a claimable assignee in the VALUES list")
        self.assertGreater(seen, 10, "the scan found too few proofs: the glob is wrong")


if __name__ == "__main__":
    unittest.main()
