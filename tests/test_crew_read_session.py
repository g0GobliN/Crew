"""crew_graph.read_session: q() handles live for one render, never for the life of the thread.

An open handle blocks deleting or replacing the db file on Windows (WinError 32), so each test ends by
removing the file: that is the assertion that fails on Windows if a handle leaked."""
import os
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "scripts"))

import crew_graph as cg  # noqa: E402


class ReadSessionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.db = os.path.join(self.tmp.name, "kanban.db")
        conn = sqlite3.connect(self.db)
        conn.execute("create table t (x integer)")
        conn.executemany("insert into t values (?)", [(1,), (2,)])
        conn.commit()
        conn.close()

    def _connects(self):
        return patch.object(cg.sqlite3, "connect", wraps=sqlite3.connect)

    def test_q_outside_a_session_leaves_no_handle(self):
        self.assertEqual(cg.q(self.db, "select x from t order by x"), [(1,), (2,)])
        os.remove(self.db)

    def test_a_session_reuses_one_handle_and_closes_it_on_exit(self):
        with self._connects() as connect:
            with cg.read_session():
                for _ in range(5):
                    self.assertEqual(cg.q(self.db, "select count(*) from t"), [(2,)])
            self.assertEqual(connect.call_count, 1)
        os.remove(self.db)

    def test_a_nested_session_joins_the_outer_one(self):
        with self._connects() as connect:
            with cg.read_session():
                cg.q(self.db, "select 1")
                with cg.read_session():
                    cg.q(self.db, "select 2")
                cg.q(self.db, "select 3")
            self.assertEqual(connect.call_count, 1)
        os.remove(self.db)

    def test_handles_are_closed_when_the_render_raises(self):
        with self.assertRaises(RuntimeError):
            with cg.read_session():
                cg.q(self.db, "select 1")
                raise RuntimeError("render failed")
        os.remove(self.db)
        self.assertIsNone(getattr(cg._q_scope, "conns", None))

    def test_a_failing_query_returns_empty_and_the_next_one_works(self):
        with cg.read_session():
            self.assertEqual(cg.q(self.db, "select nope from missing"), [])
            self.assertEqual(cg.q(self.db, "select count(*) from t"), [(2,)])
        os.remove(self.db)

    def test_a_session_does_not_leak_into_another_thread(self):
        import threading
        seen = []
        with cg.read_session():
            t = threading.Thread(target=lambda: seen.append(getattr(cg._q_scope, "conns", None)))
            t.start()
            t.join(5)
        self.assertEqual(seen, [None])
        os.remove(self.db)


if __name__ == "__main__":
    unittest.main()
