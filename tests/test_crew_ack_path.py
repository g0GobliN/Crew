"""Acks belong to the board: the default file sits beside the active kanban.db, whichever plugin copy reads it."""
import json
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
for p in (ROOT, os.path.join(ROOT, "scripts")):
    if p not in sys.path:
        sys.path.insert(0, p)

from tests import kernel_board as kbd  # noqa: E402
import crew_graph_serve as cgs  # noqa: E402


class AckPathTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="crew-ackpath-")
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        keys = ("CREW_ACK_FILE", "KANBAN_DB", "HERMES_KANBAN_DB", "HERMES_HOME", "HERMES_BIN")
        saved = {k: os.environ.get(k) for k in keys}
        def restore():
            for k, v in saved.items():
                os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)
        self.addCleanup(restore)
        os.environ.pop("CREW_ACK_FILE", None)
        os.environ.pop("HERMES_KANBAN_DB", None)
        os.environ["HERMES_HOME"] = self.tmp
        os.environ.setdefault("HERMES_BIN", "/bin/false")

    def board(self, name):
        d = os.path.join(self.tmp, name)
        os.makedirs(d)
        kb, conn, db = kbd.open_board(d)
        self.addCleanup(conn.close)
        card = kbd.add_card(conn, status="blocked", title=name)
        return db, card

    def use(self, db):
        os.environ["HERMES_KANBAN_DB"] = db

    def test_same_board_two_plugin_dirs_share_one_file_and_two_boards_do_not(self):
        db1, c1 = self.board("b1")
        db2, c2 = self.board("b2")
        self.use(db1)
        path1 = cgs.ack_path()
        self.assertEqual(path1, os.path.join(os.path.dirname(db1), "crew", "attention_acks.json"))
        cgs.ack_card(c1)
        # a second plugin copy (another HERE) resolves the same board -> the same file, and sees the ack
        orig = cgs.HERE
        cgs.HERE = os.path.join(self.tmp, "other-plugin", "scripts")
        try:
            self.assertEqual(cgs.ack_path(), path1)
            self.assertIn(c1, cgs.load_acks())
        finally:
            cgs.HERE = orig
        self.use(db2)
        self.assertNotEqual(cgs.ack_path(), path1)
        self.assertEqual(cgs.load_acks(), {})

    def test_legacy_file_is_read_then_copied_on_first_write_and_kept(self):
        db, card = self.board("b")
        self.use(db)
        legacy = cgs.legacy_ack_path()
        os.makedirs(os.path.dirname(legacy), exist_ok=True)
        before = os.path.exists(legacy)
        orig = cgs.HERE
        cgs.HERE = os.path.join(self.tmp, "plug", "scripts")
        try:
            legacy = cgs.legacy_ack_path()
            os.makedirs(os.path.dirname(legacy))
            with open(legacy, "w", encoding="utf-8") as fh:
                json.dump({"t_old": "done"}, fh)
            self.assertEqual(cgs.load_acks(), {"t_old": "done"})
            self.assertFalse(os.path.exists(cgs.ack_path()))
            cgs.ack_card(card)
            with open(cgs.ack_path(), encoding="utf-8") as fh:
                self.assertEqual(set(json.load(fh)), {"t_old", card})
            with open(legacy, encoding="utf-8") as fh:
                self.assertEqual(json.load(fh), {"t_old": "done"})   # never deleted or edited
        finally:
            cgs.HERE = orig

    def test_override_wins_and_ignores_legacy(self):
        db, card = self.board("b")
        self.use(db)
        override = os.path.join(self.tmp, "mine.json")
        os.environ["CREW_ACK_FILE"] = override
        self.assertEqual(cgs.ack_path(), override)
        cgs.ack_card(card)
        self.assertTrue(os.path.exists(override))
        self.assertFalse(os.path.exists(os.path.join(os.path.dirname(db), "crew", "attention_acks.json")))


if __name__ == "__main__":
    unittest.main()
