"""POST /action/<name> (dashboard/plugin_api.py): the Hermes Desktop buttons. One allowlisted name per slash command,
each calling the same crew function the command calls and answering {ok, text}; Stop also needs confirm true."""
import os
import sys
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

HERE = os.path.dirname(os.path.abspath(__file__))
CREW_ROOT = os.path.dirname(HERE)
for p in (HERE, CREW_ROOT, os.path.join(CREW_ROOT, "scripts")):
    if p not in sys.path:
        sys.path.insert(0, p)

from dashboard.plugin_api import router  # noqa: E402
from test_crew_dashboard_customization import RealBoardCase  # noqa: E402

API = "/api/plugins/crew"


class ActionRouteTests(RealBoardCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(router, prefix=API)
        self.client = TestClient(app)
        import crew_card
        import crew_stop
        self.crew_card, self.crew_stop = crew_card, crew_stop

    def post(self, name, body):
        return self.client.post(API + "/action/" + name, json=body)

    def test_only_the_four_names_exist(self):
        for bad in ("safety", "exec", "..", "Unstuck", "ack"):
            r = self.post(bad, {"card": self.card})
            self.assertIn(r.status_code, (400, 404), bad)
        r = self.post("exec", {"card": self.card})
        self.assertEqual((r.status_code, r.json()["ok"]), (400, False))

    def test_bad_card_id_is_400_before_any_function_runs(self):
        with patch.object(self.crew_card, "unstuck_card") as fn:
            for body in ({}, {"card": ""}, {"card": "../x"}, {"card": "a b"}, {"card": 7}, {"card": "t_x.json"}):
                r = self.post("unstuck", body)
                self.assertEqual((r.status_code, r.json()["ok"]), (400, False), body)
            fn.assert_not_called()

    def test_get_is_not_allowed(self):
        self.assertEqual(self.client.get(API + "/action/unstuck").status_code, 405)

    def test_unstuck_calls_unstuck_card(self):
        with patch.object(self.crew_card, "unstuck_card", return_value=(True, "t_1: blocked -> ready")) as fn:
            r = self.post("unstuck", {"card": self.blocked})
        fn.assert_called_once_with(self.blocked)
        self.assertEqual(r.json(), {"ok": True, "text": "t_1: blocked -> ready"})
        with patch.object(self.crew_card, "unstuck_card", return_value=(False, "nothing to unstick")):
            self.assertEqual(self.post("unstuck", {"card": self.card}).json(), {"ok": False, "text": "nothing to unstick"})

    def test_unstuck_runs_the_real_function_on_a_missing_card(self):
        r = self.post("unstuck", {"card": "t_nosuchcard"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), {"ok": False, "text": "no such card: t_nosuchcard"})

    def test_retry_calls_retry_card_with_its_defaults(self):
        res = {"ok": True, "card": "t_1", "status": "blocked", "assignee": "w", "spent": 10, "budget": 250000,
               "dry_run": False, "ledgers_moved": 1, "unblock": {"out": "ok", "rc": 0}}
        with patch.object(self.crew_card, "retry_card", return_value=res) as fn:
            r = self.post("retry", {"card": self.blocked}).json()
        args, kwargs = fn.call_args
        self.assertEqual(args, (self.blocked,))
        self.assertEqual(set(kwargs), {"profile"})
        self.assertTrue(r["ok"])
        self.assertIn("new ceiling: 250,000 tokens", r["text"])
        with patch.object(self.crew_card, "retry_card", return_value={"ok": False, "why": "no such card: t_9"}):
            self.assertEqual(self.post("retry", {"card": "t_9"}).json(), {"ok": False, "text": "no such card: t_9"})

    def test_proof_modes(self):
        with patch.object(self.crew_card, "owner_proof_answer", return_value="confirmed proof for t_1: ./p (brave); card ready") as fn:
            r = self.post("proof", {"card": self.card, "mode": "brave"}).json()
            fn.assert_called_once_with(self.card, brave=True)
        self.assertTrue(r["ok"])
        with patch.object(self.crew_card, "owner_proof_answer", return_value="no open proof question on t_1") as fn:
            r = self.post("proof", {"card": self.card}).json()   # no mode: the plain yes
            fn.assert_called_once_with(self.card, brave=False)
        self.assertEqual(r, {"ok": False, "text": "no open proof question on t_1"})
        self.assertEqual(self.post("proof", {"card": self.card, "mode": "rm"}).status_code, 400)

    def test_stop_needs_confirm_true(self):
        with patch.object(self.crew_stop, "run") as fn:
            for body in ({"card": self.card}, {"card": self.card, "confirm": False}, {"card": self.card, "confirm": "yes"}):
                r = self.post("stop", body)
                self.assertEqual((r.status_code, r.json()["ok"]), (400, False), body)
            fn.assert_not_called()

    def test_stop_calls_crew_stop_for_the_one_card(self):
        with patch.object(self.crew_stop, "run", return_value=(0, "stop: 1 card(s), 1 run(s) killed")) as fn:
            r = self.post("stop", {"card": self.card, "confirm": True})
        fn.assert_called_once_with([self.card])
        self.assertEqual(r.json(), {"ok": True, "text": "stop: 1 card(s), 1 run(s) killed"})
        with patch.object(self.crew_stop, "run", return_value=(1, "NOT DOWN")):
            self.assertEqual(self.post("stop", {"card": self.card, "confirm": True}).json(), {"ok": False, "text": "NOT DOWN"})

    def test_stop_on_a_missing_card_says_so(self):
        r = self.post("stop", {"card": "t_nosuchcard", "confirm": True})   # the real stop pass, a card it does not know
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.json()["ok"])

    def test_a_raising_function_answers_ok_false(self):
        with patch.object(self.crew_card, "unstuck_card", side_effect=OSError("db gone")):
            from dashboard import plugin_api
            with self.assertLogs(plugin_api._log, "ERROR"):
                r = self.post("unstuck", {"card": self.card})
        self.assertEqual((r.status_code, r.json()), (200, {"ok": False, "text": "unstuck failed: db gone"}))


if __name__ == "__main__":
    unittest.main()
