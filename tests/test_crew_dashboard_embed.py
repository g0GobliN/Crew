"""The Hermes Desktop routes (dashboard/plugin_api.py /embed/*): JSON envelopes for what ctx.rest cannot carry.

ctx.rest answers JSON only, so a role's face comes as a data URL (/embed/avatar) and an ack's plain-text answer inside
an envelope (/embed/ack). The HTML envelopes (/embed/board, /embed/card) and the postMessage bridge went away with the
iframe. Built in-process from crew's own builders on a real temp kanban board; no daemon and no port.
"""
import base64
import json
import os
import sys
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

HERE = os.path.dirname(os.path.abspath(__file__))
CREW_ROOT = os.path.dirname(HERE)
for p in (HERE, CREW_ROOT, os.path.join(CREW_ROOT, "scripts")):
    if p not in sys.path:
        sys.path.insert(0, p)

from tests import kernel_board as kbd  # noqa: E402
from dashboard import plugin_api  # noqa: E402
from dashboard.plugin_api import router  # noqa: E402
from test_crew_dashboard_customization import RealBoardCase  # noqa: E402

API = "/api/plugins/crew"


def _client():
    app = FastAPI()
    app.include_router(router, prefix=API)
    return TestClient(app)


class EmbedRouteTests(RealBoardCase):
    def setUp(self):
        self.client = _client()

    def test_the_iframe_routes_and_the_page_routes_are_gone(self):
        for path in ("/embed/board", "/embed/card/" + self.card, "/embed/card/t_nosuchcard", "/board"):
            self.assertEqual(self.client.get(API + path).status_code, 404, path)
        self.assertFalse(hasattr(plugin_api, "_EMBED_BRIDGE_JS"))
        self.assertFalse(hasattr(plugin_api, "_BRIDGE_JS"))

    def test_embed_avatar_data_url_and_validation(self):
        resp = self.client.get(API + "/embed/avatar/role/worker.svg")
        self.assertEqual(resp.status_code, 200, resp.text)
        url = resp.json()["data_url"]
        prefix = "data:image/svg+xml;base64,"
        self.assertTrue(url.startswith(prefix))
        self.assertIn(b"<svg", base64.b64decode(url[len(prefix):]))
        for bad in ("../x.svg", "role/..%2F..%2Fx.svg", "role/worker.exe", "role/a b.svg"):
            self.assertIn(self.client.get(API + "/embed/avatar/" + bad).status_code, (400, 404), bad)

    def test_embed_ack_applies_server_side_and_wraps_the_answer(self):
        hdr = {"Origin": "http://127.0.0.1:9119"}
        resp = self.client.post(API + "/embed/ack/all?undo=1", headers=hdr)
        self.assertEqual(resp.status_code, 200)
        env = resp.json()
        self.assertEqual((env["ok"], env["status"]), (True, 200))
        self.assertIn("restored", env["text"])
        cleared = self.client.post(API + "/embed/ack/" + self.blocked, headers=hdr).json()
        self.assertEqual((cleared["ok"], cleared["status"], cleared["text"]), (True, 200, "cleared %s\n" % self.blocked))
        self.assertEqual(self.client.post(API + "/embed/ack/%s?undo=1" % self.blocked, headers=hdr).json()["status"], 200)
        busy = self.client.post(API + "/embed/ack/" + self.card, headers=hdr).json()   # ready card: 409 inside a 200
        self.assertEqual((busy["ok"], busy["status"]), (False, 409))
        # an upstream refusal is an answer inside a 200, not a transport error
        miss = self.client.post(API + "/embed/ack/t_nosuchcard", headers=hdr).json()
        self.assertEqual((miss["ok"], miss["status"]), (False, 404))
        self.assertIn("no card", miss["text"])
        self.assertEqual(self.client.post(API + "/embed/ack/a%2Fb").status_code, 404)
        self.assertEqual(self.client.get(API + "/embed/ack/all").status_code, 405)

    def test_existing_ack_route_still_plain_text(self):
        resp = self.client.post(API + "/ack/all?undo=1", headers={"Origin": "http://127.0.0.1:9119"})
        self.assertEqual(resp.status_code, 200)
        self.assertIn("restored", resp.text)
        self.assertTrue(resp.headers["content-type"].startswith("text/plain"))


class EmbedFailureTests(RealBoardCase):
    def test_a_failing_builder_is_a_500_not_a_hang_and_ack_keeps_its_envelope(self):
        import crew_graph_serve
        client = _client()
        with patch.object(crew_graph_serve, "face_svg", side_effect=OSError("disk gone")), \
                patch.object(crew_graph_serve, "ack_all", side_effect=OSError("disk gone")):
            with self.assertLogs(plugin_api._log, "ERROR"):
                resp = client.get(API + "/embed/avatar/role/worker.svg")
                ack = client.post(API + "/embed/ack/all")
        self.assertEqual(resp.status_code, 500)
        self.assertNotIn("disk gone", resp.text)
        self.assertEqual((ack.status_code, ack.json()["status"], ack.json()["ok"]), (200, 500, False))


if __name__ == "__main__":
    unittest.main()
