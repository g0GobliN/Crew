"""dashboard/plugin_api.py's render cache.

The board and card routes are polled every 2 s by Hermes Desktop and every dashboard tab, and each
miss rebuilds the whole graph: 64 queries for a board render and 108-118 for one card graph. Those
rebuilds are CPU-bound Python sharing one GIL, so one build must serve a whole wave (the test below
proves 12 concurrent readers cause one build), and a request that finds an expired entry must never
queue behind the thread that is refreshing it.
"""
import os
import sys
import threading
import time
import unittest
from unittest.mock import patch

HERE = os.path.dirname(os.path.abspath(__file__))
CREW_ROOT = os.path.dirname(HERE)
for p in (HERE, CREW_ROOT, os.path.join(CREW_ROOT, "scripts")):
    if p not in sys.path:
        sys.path.insert(0, p)

from dashboard import plugin_api as api  # noqa: E402

BOARD = "/api/plugins/crew/board.json"
CARD = "/api/plugins/crew/card/t_abc.json"
CREW = object()          # stands in for the loaded crew_graph_serve module


class _URL:
    def __init__(self, path, query=""):
        self.path, self.query = path, query


class _Request:
    def __init__(self, path, query="", method="GET", query_params=None):
        self.method = method
        self.url = _URL(path, query)
        self.query_params = query_params or {}


def _payload(status=200, body='{"ok":true}', ctype="application/json"):
    def make(crew):
        assert crew is CREW, "make must receive the loaded crew module"
        return status, body, ctype
    return make


class RenderCacheTests(unittest.TestCase):
    def setUp(self):
        api._cache.clear()
        self._crew = patch.object(api, "_crew", return_value=CREW)
        self._crew.start()
        self.addCleanup(self._crew.stop)
        self.addCleanup(api._cache.clear)

    def _counting(self, status=200):
        calls = []

        def make(crew):
            calls.append(crew)
            return status, '{"n":%d}' % len(calls), "application/json"
        return make, calls

    def test_repeated_get_builds_once_and_serves_the_same_bytes(self):
        make, calls = self._counting()
        req = _Request(BOARD)
        answers = [api._build(req, make, None) for _ in range(5)]
        self.assertEqual(len(calls), 1, "a cached read must not rebuild")
        self.assertEqual(len({a[1] for a in answers}), 1, "every reader sees one payload")
        self.assertEqual(answers[0][0], 200)

    def test_a_concurrent_wave_builds_once(self):
        make, calls = self._counting()
        req = _Request(CARD)
        out = []
        lock = threading.Lock()

        def reader():
            st, content, _ = api._build(req, make, None)
            with lock:
                out.append((st, content))

        threads = [threading.Thread(target=reader) for _ in range(12)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)
        self.assertEqual(len(out), 12)
        self.assertEqual(len(calls), 1, "12 concurrent readers, one graph build")
        self.assertEqual(len({c for _, c in out}), 1)

    def test_post_is_never_cached(self):
        make, calls = self._counting()
        req = _Request("/api/plugins/crew/ack/all", method="POST")
        for _ in range(3):
            api._build(req, make, None)
        self.assertEqual(len(calls), 3, "a write must always build")

    def test_a_write_drops_the_cached_reads(self):
        get_make, get_calls = self._counting()
        board = _Request(BOARD)
        api._build(board, get_make, None)
        api._build(board, get_make, None)
        self.assertEqual(len(get_calls), 1, "precondition: the read is cached")

        ack_make = lambda crew: (200, "ok", "text/plain")  # noqa: E731 - one-line builder for the write
        api._build(_Request("/api/plugins/crew/ack/all", method="POST"), ack_make, None)
        api._build(board, get_make, None)
        self.assertEqual(len(get_calls), 2, "the board must be rebuilt after a write, not served stale")

    def test_an_action_write_drops_the_cached_reads(self):
        get_make, get_calls = self._counting()
        board = _Request(BOARD)
        api._build(board, get_make, None)
        self.assertEqual(len(get_calls), 1, "precondition: the read is cached")

        with patch.object(api, "_run_action", return_value=(True, "ok")):
            api.post_action("unstuck", {"card": "t_abc"})
        api._build(board, get_make, None)
        self.assertEqual(len(get_calls), 2, "an /action/ write changes the board too: it must drop the reads")

    def test_a_refresh_does_not_publish_across_a_write(self):
        req = _Request(BOARD)
        key = (req.method, req.url.path, req.url.query, "", api._board_identity())
        started, release = threading.Event(), threading.Event()

        def slow_make(crew):
            started.set()
            release.wait(10)
            return 200, '{"stale":true}', "application/json"

        refresher = threading.Thread(target=lambda: api._build(req, slow_make, None))
        refresher.start()
        self.assertTrue(started.wait(10), "the refresh must start building")
        api._invalidate()                      # a write lands while the read is being built
        release.set()
        refresher.join(timeout=10)

        self.assertNotIn(key, api._cache, "a value built before a write must not be published after it")

    def test_expired_entries_are_pruned(self):
        for i in range(50):
            api._cache[("GET", "/api/plugins/crew/card/t_%d.json" % i, "", "")] = (
                time.monotonic() - 1, (200, b"old", "application/json"))
        make, _ = self._counting()
        api._build(_Request(BOARD), make, None)
        self.assertLessEqual(len(api._cache), 1, "expired keys must not accumulate for the life of the process")

    def test_a_failed_build_caches_nothing_and_leaves_the_key_lock_free(self):
        req = _Request(BOARD)
        key = (req.method, req.url.path, req.url.query, "", api._board_identity())

        def boom(crew):
            raise RuntimeError("render failed")

        with self.assertRaises(RuntimeError):
            api._build(req, boom, None)
        self.assertNotIn(key, api._cache)
        self.assertFalse(api._key_lock(key).locked(), "a failed build must not wedge the route")

        make, calls = self._counting()
        self.assertEqual(api._build(req, make, None)[1], b'{"n":1}', "the next reader builds normally")
        self.assertEqual(len(calls), 1)

    def test_a_switch_to_another_board_is_not_served_from_the_cache(self):
        make, calls = self._counting()
        req = _Request(BOARD)
        for db in (os.path.join("board-a", "kanban.db"), os.path.join("board-b", "kanban.db")):
            with patch.object(api, "_board_identity", return_value=db):
                api._build(req, make, None)
        self.assertEqual(len(calls), 2, "another board's answer must never be served")

    def test_healthz_always_builds(self):
        api._cache.clear()
        counts = []

        def board_data():
            counts.append(1)
            return {"cards": 0, "live": 0}

        def _health(crew):
            board = board_data()
            return 200, "ok crew board cards=%s\n" % board["cards"], "text/plain; charset=utf-8"

        req = _Request("/api/plugins/crew/healthz")
        for _ in range(3):
            api._build(req, _health, None)
        self.assertEqual(len(counts), 3, "a health check must read the board every time, never a cached answer")

    def test_error_answers_are_not_cached(self):
        make, calls = self._counting(status=404)
        req = _Request(CARD)
        for _ in range(3):
            self.assertEqual(api._build(req, make, None)[0], 404)
        self.assertEqual(len(calls), 3, "an error must be retried, not remembered")

    def test_query_and_path_are_separate_keys(self):
        make, calls = self._counting()
        api._build(_Request(BOARD), make, None)
        api._build(_Request(BOARD, query="all=1"), make, None)
        api._build(_Request(CARD), make, None)
        self.assertEqual(len(calls), 3)

    def test_an_expired_entry_is_served_while_one_refresher_rebuilds(self):
        req = _Request(BOARD)
        key = (req.method, req.url.path, req.url.query, "", api._board_identity())
        api._cache[key] = (time.monotonic() - 1, (200, b"old", "application/json"))
        release = threading.Event()
        started = threading.Event()
        builds = []

        def slow_make(crew):
            builds.append(1)
            started.set()
            release.wait(10)
            return 200, '{"fresh":true}', "application/json"

        refresher = threading.Thread(target=lambda: api._build(req, slow_make, None))
        refresher.start()
        self.assertTrue(started.wait(10), "the refresher must start building")

        t0 = time.monotonic()
        st, content, _ = api._build(req, slow_make, None)
        waited = time.monotonic() - t0
        self.assertLess(waited, 1.0, "a reader must not block behind the refresh")
        self.assertEqual((st, content), (200, b"old"), "the stale value is served")
        self.assertEqual(len(builds), 1, "no second build was started")

        release.set()
        refresher.join(timeout=10)
        self.assertEqual(api._build(req, slow_make, None)[1], b'{"fresh":true}')


if __name__ == "__main__":
    unittest.main()
