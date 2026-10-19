"""board_data tiles carry `proof_ask`, the kind of proof question waiting for the owner: the Desktop tile buttons
enable Proof from it, with the same rule as the card page. Needs the Hermes venv python (tests/kernel_board.py)."""
import importlib.util
import os
import tempfile
import unittest

from tests import kernel_board as kbd

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class TileProofAsk(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.saved = {k: os.environ.get(k) for k in ("KANBAN_DB", "HERMES_KANBAN_DB")}
        self.addCleanup(self.restore)
        kb, self.conn, self.path = kbd.open_board(self.tmp.name)
        self.addCleanup(self.conn.close)
        os.environ["KANBAN_DB"] = self.path
        spec = importlib.util.spec_from_file_location("cgs_proof_ask", os.path.join(HERE, "scripts", "crew_graph_serve.py"))
        self.mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.mod)

    def restore(self):
        for k, v in self.saved.items():
            os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)

    def tiles(self):
        return {t["id"]: t for l in self.mod.board_data()["lanes"] for t in l["tiles"]}

    def test_a_pending_proof_ask_rides_on_its_tile_and_others_carry_none(self):
        asked = kbd.add_card(self.conn, status="blocked", title="needs the proof go")
        plain = kbd.add_card(self.conn, status="blocked", title="blocked, no question")
        ready = kbd.add_card(self.conn, status="ready", title="queued")
        self.mod.CG.crew_card._append_card_event(
            asked, "crew_decision", {"decision": "ask_owner", "proof_ask": {"kind": "blocked", "command": "rm x", "reason": "flagged"}},
            db=self.path)
        t = self.tiles()
        self.assertEqual("blocked", t[asked]["proof_ask"])
        self.assertEqual("", t[plain]["proof_ask"])
        self.assertEqual("", t[ready]["proof_ask"])


if __name__ == "__main__":
    unittest.main()
