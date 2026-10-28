"""Hermes.Crew dashboard plugin - the board and card JSON, the app script and the acks, served in-process.

Mounted at /api/plugins/crew/ by the dashboard plugin system
(hermes_cli.web_server._mount_plugin_api_routes), behind Hermes's own auth
middleware: every route here needs the dashboard session token (header) or the
OAuth session cookie, exactly like any other /api/ route. There is no HTML page
here: the web dashboard tab (dist/index.js) fetches /app.js with the SDK's
authedFetch and runs it, and the app (the same one the standalone server serves
and Hermes Desktop loads) polls the JSON routes below through the same authedFetch.
Desktop's ctx.rest reaches the same JSON routes; it answers JSON only, so the
/embed/ routes wrap an ack's text and a face's bytes in JSON.

Every JSON document, face and ack is built here, in the Hermes web server
process, by crew's own builders in <plugin>/scripts/crew_graph_serve.py (the same
functions the standalone daemon calls): no daemon has to run, so this works where
there is no systemd (Windows) and is the base a remote backend builds on. Routes
are plain `def`, so FastAPI runs them in its threadpool: board_data and the graph
build read sqlite and session stores and never block the event loop.

What replaces the daemon's own request checks (crew_graph_serve.Handler):
  - Host allowlist (421) and the tailnet-login check: the Hermes server's host-header
    middleware and its auth middleware (session token / OAuth gate) run before any
    route here; there is no second listener to protect.
  - _same_origin on POST /ack: the daemon needs it because a browser sends its ambient
    cookies to any origin. Here a write must carry the dashboard session token header
    (the tab's authedFetch, Desktop's ctx.rest) or the OAuth session, which Hermes's auth
    middleware checks first; a cross-site page cannot set that header. The route also
    takes POST only (GET answers 405), validates the action name, and a refused write
    never reaches the ack file.
"""

from __future__ import annotations

import base64
import importlib
import importlib.util
import json
import logging
import os
import re
import sys
import threading
import time
from fastapi import APIRouter, Body, HTTPException, Request, Response
from fastapi.responses import JSONResponse

_log = logging.getLogger(__name__)

router = APIRouter()

# crew's scripts sit next to this folder, in the dev tree and in an installed plugins/crew/.
SCRIPTS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts")

# A card id, optionally with the .json suffix the card page polls (card/<id>.json).
_CARD_ID_RE = re.compile(r"^[a-zA-Z0-9_-]+(?:\.json)?$")
_ACK_PATH_RE = re.compile(r"^[a-zA-Z0-9_-]+$")
_AVATAR_PATH_RE = re.compile(r"^[a-zA-Z0-9_/-]+\.(?:svg|png)$")

# Headers every response carries (the daemon sent the same three).
_RESPONSE_HEADERS = {
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
}

_crew_lock = threading.Lock()
_crew_mod = None

# Repeated identical reads (the board and the card being watched, polled by Desktop and every dashboard
# tab) are served from a short-TTL cache with single-flight per key. Without it each poll re-renders the
# whole graph, and those renders are CPU-bound Python sharing one GIL, so a wave of concurrent misses
# costs one render per reader. With the cache one build serves the whole wave.
_CACHE_TTL_SECONDS = 3.0
# /healthz answers for the board it just read: a cached one could report health the plugin no longer has,
# so it is the one GET that always builds.
_UNCACHED_PATHS = ("/healthz",)
_cache = {}                      # key -> (expires_monotonic, (status, content, content_type))
_cache_lock = threading.Lock()
_cache_generation = 0            # bumped by every write; a build from before it is never published
_key_locks = {}
_key_locks_guard = threading.Lock()


def _key_lock(key):
    """The single-flight lock for one cache key, so a wave waits for one render, not N."""
    with _key_locks_guard:
        lock = _key_locks.get(key)
        if lock is None:
            lock = _key_locks[key] = threading.Lock()
        return lock


def _render_answer(make):
    """(status, content bytes, content type) from one builder call."""
    status, body, content_type = make(_crew())
    return status, (body.encode("utf-8") if isinstance(body, str) else body), content_type


def _invalidate():
    """Drop every cached read after a write, and disown builds already in flight: a render that
    started before the write and finishes after it would otherwise publish the pre-write board."""
    global _cache_generation
    with _cache_lock:
        _cache.clear()
        _cache_generation += 1


def _board_identity() -> str:
    """The board this answer would be built from, so a cached answer can never outlive a switch to another
    one (a second HERMES_HOME in the same process still gets its own keys)."""
    try:
        _crew()                                # loads scripts/ onto sys.path
        return importlib.import_module("crew_card").kanban_db() or ""
    except Exception:
        return ""


def _build(request: Request, make, embed: str | None):
    """This GET's answer from the cache; writes (acks) always build fresh.

    Stale-while-revalidate: a request that finds the entry expired takes the refresh lock when it is
    free and rebuilds; otherwise it is answered from the value already there. Waiting threads would
    hold FastAPI's whole pool while one render runs, and the pool is what every other route needs.

    """
    key = (request.method, request.url.path, request.url.query, embed or "", _board_identity())
    cacheable = request.method == "GET" and not request.url.path.rstrip("/").endswith(_UNCACHED_PATHS)
    ttl = _CACHE_TTL_SECONDS if cacheable else 0.0
    if not ttl:
        built = _render_answer(make)
        # A write (ack, card action) changes the board: drop the reads so the next poll shows it,
        # instead of serving the pre-write answer for the rest of the TTL.
        _invalidate()
        return built
    entry = _cache.get(key)
    if entry is not None and entry[0] > time.monotonic():
        return entry[1]
    if entry is not None:                 # stale: one refresher, everyone else is served
        lock = _key_lock(key)
        if not lock.acquire(blocking=False):
            return entry[1]
        try:
            entry = _cache.get(key)
            if entry is not None and entry[0] > time.monotonic():
                return entry[1]
            return _refresh(key, make, ttl)
        finally:
            lock.release()
    with _key_lock(key):                  # cold: the first wave waits for the one build
        entry = _cache.get(key)
        if entry is not None:
            return entry[1]
        return _refresh(key, make, ttl)


def _refresh(key, make, ttl):
    """Build one answer and store it; an error answer is never cached, and an expired entry is dropped
    rather than kept for the life of the process (the process outlives every card a board ever held)."""
    with _cache_lock:
        generation = _cache_generation
    built = _render_answer(make)
    if 200 <= built[0] < 300:
        now = time.monotonic()
        with _cache_lock:
            if generation == _cache_generation:      # a write landed meanwhile: do not publish this one
                _cache[key] = (now + ttl, built)
            for stale in [k for k, v in _cache.items() if v[0] <= now]:
                del _cache[stale]
    return built


def _crew():
    """crew_graph_serve, loaded once from this plugin's own scripts/ (never from a path on sys.path).

    It resolves HERMES_HOME and the kanban board through crew_card.kanban_db(), the one resolver, in this process's
    environment: where hermes_cli is importable (it is, inside the Hermes web server) that is Hermes's own
    kanban_db_path(), the same file the daemon's bare-interpreter fallback mirrors."""
    global _crew_mod
    with _crew_lock:
        if _crew_mod is None:
            path = os.path.join(SCRIPTS_DIR, "crew_graph_serve.py")
            loaded = sys.modules.get("crew_graph_serve")
            if loaded is not None and os.path.abspath(getattr(loaded, "__file__", "")) == os.path.abspath(path):
                _crew_mod = loaded
            else:
                if SCRIPTS_DIR not in sys.path:
                    sys.path.insert(0, SCRIPTS_DIR)   # crew_graph imports crew_card / crew_result by bare name
                spec = importlib.util.spec_from_file_location("crew_graph_serve", path)
                mod = importlib.util.module_from_spec(spec)
                sys.modules["crew_graph_serve"] = mod
                try:
                    spec.loader.exec_module(mod)
                except BaseException:
                    sys.modules.pop("crew_graph_serve", None)
                    raise
                _crew_mod = mod
        return _crew_mod


def _text_envelope(status: int, content: bytes) -> Response:
    """An ack's plain-text answer as JSON, with its status inside: ctx.rest throws on a non-2xx, and a 409
    ("only a row on the list is cleared") is an answer the page shows, not a transport failure."""
    return Response(content=json.dumps({"ok": 200 <= status < 300, "status": status,
                                        "text": content.decode("utf-8", errors="replace")}),
                    status_code=200, media_type="application/json")


def _render(request: Request, make, embed: str | None = None) -> Response:
    """Build one response in-process. make(crew) -> (status, body, content type) calls crew's builders.

    embed (the /embed/ routes only): "asset" returns {data_url}, "text" {ok, status, text}; a non-200 passes
    through unchanged for both modes but "text". An exception is a 500 with the detail in the server log only
    (for "text", a 500 inside the envelope): there is no second path to fall back to."""
    try:
        status, content, content_type = _build(request, make, embed)
        if status >= 400 and embed != "text":   # an error answer passes through as built (as the daemon's did)
            return Response(content=content, status_code=status, media_type=content_type)
        if embed == "asset" and status == 200:
            mime = content_type.split(";")[0].strip()
            data_url = f"data:{mime};base64," + base64.b64encode(content).decode("ascii")
            return Response(content=json.dumps({"data_url": data_url}), status_code=200,
                            headers={"Cache-Control": "no-store"}, media_type="application/json")
        if embed == "text":
            return _text_envelope(status, content)
        return Response(content=content, status_code=status, headers=dict(_RESPONSE_HEADERS), media_type=content_type)
    except Exception:
        _log.exception("crew dashboard: building %s failed", request.url.path)
        if embed == "text":
            return _text_envelope(500, b"crew could not build this answer; see the Hermes server log\n")
        return Response(content="crew could not build this answer; see the Hermes server log\n", status_code=500,
                        media_type="text/plain")


def _flag(request: Request, name: str) -> bool:
    return request.query_params.get(name) == "1"


def _board_json(request: Request):
    show_all, older = _flag(request, "all"), _flag(request, "older")
    return lambda crew: (200, crew.board_json(show_all, older), "application/json")


def _card(card_id: str):
    return lambda crew: crew.card_response(card_id)


def _app_js(crew):
    js = crew.app_js()
    if js is None:
        return 404, "not found\n", "text/plain; charset=utf-8"
    return 200, js, "text/javascript; charset=utf-8"


def _avatar(avatar_path: str):
    def make(crew):
        m = crew.FACE_RX.match("/avatars/" + avatar_path)
        svg = crew.face_svg(m.group(1)) if m else None
        if svg is None:
            return 404, "not found\n", "text/plain; charset=utf-8"
        return 200, svg, "image/svg+xml"
    return make


def _ack(action: str, undo: bool):
    def make(crew):
        code, text = crew.ack_all(undo=undo) if action == "all" else crew.ack_card(action, undo=undo)
        return code, text, "text/plain; charset=utf-8"
    return make


def _health(crew):
    try:
        board = crew.board_data()
        body = "ok crew board cards=%s live=%s\n" % (board.get("cards"), board.get("live"))
    except Exception:
        _log.exception("crew dashboard: health could not read the board")
        body = "ok crew board (no data; see the Hermes server log)\n"
    return 200, body, "text/plain; charset=utf-8"


# The app: the one script the web dashboard tab (dist/index.js) fetches with authedFetch and runs. The same file the
# standalone server serves at /app.js; it draws the board and the card page and polls the JSON routes below.
@router.get("/app.js")
def get_app_js(request: Request):
    return _render(request, _app_js)


@router.get("/board.json")
def get_board_json(request: Request):
    return _render(request, _board_json(request))


@router.get("/card/{card_id}")
def get_card(card_id: str, request: Request):
    if not _CARD_ID_RE.match(card_id):
        raise HTTPException(status_code=400, detail="Invalid card ID format")
    return _render(request, _card(card_id))


@router.post("/ack/{action}")
def post_ack(action: str, request: Request):
    if not _ACK_PATH_RE.match(action):
        raise HTTPException(status_code=400, detail="Invalid ack target format")
    return _render(request, _ack(action, _flag(request, "undo")))


@router.get("/avatars/{avatar_path:path}")
def get_avatars(avatar_path: str, request: Request):
    if ".." in avatar_path or not _AVATAR_PATH_RE.match(avatar_path):
        raise HTTPException(status_code=400, detail="Invalid avatar asset path")
    return _render(request, _avatar(avatar_path))


@router.get("/healthz")
def get_healthz(request: Request):
    return _render(request, _health)


# --- Hermes Desktop (desktop/plugin.js): ctx.rest answers JSON only, so a face comes as a data URL and an ack's
# plain-text answer rides in an envelope. Ids and names are validated exactly like the routes above.
@router.get("/embed/avatar/{avatar_path:path}")
def get_embed_avatar(avatar_path: str, request: Request):
    if ".." in avatar_path or not _AVATAR_PATH_RE.match(avatar_path):
        raise HTTPException(status_code=400, detail="Invalid avatar asset path")
    return _render(request, _avatar(avatar_path), embed="asset")


@router.post("/embed/ack/{action}")
def post_embed_ack(action: str, request: Request):
    if not _ACK_PATH_RE.match(action):
        raise HTTPException(status_code=400, detail="Invalid ack target format")
    return _render(request, _ack(action, _flag(request, "undo")), embed="text")


# --- Hermes Desktop buttons: one POST per command, the same function the slash command calls, {ok, text} back.
# The names are allowlisted here and again in the UI (ui/src/components/ActionBar.tsx). A write needs the dashboard
# session header like every route above; Stop also needs {"confirm": true} in the body, so a stray POST cannot park a
# card. The slash commands write no card event of their own (the proof answer writes its own proof_confirm), so
# neither does this route.
_ACTION_NAMES = ("unstuck", "retry", "proof", "stop")


def _action_error(status: int, text: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"ok": False, "text": text}, headers=dict(_RESPONSE_HEADERS))


def _run_action(name: str, card: str, mode: str) -> tuple[bool, str]:
    """(ok, text) of one command, from crew's own scripts (loaded by _crew() onto sys.path)."""
    _crew()
    crew_card = importlib.import_module("crew_card")
    if name == "unstuck":                       # _cmd_unstuck: crew_card.unstuck_card(card)[1]
        return crew_card.unstuck_card(card)
    if name == "proof":                         # _cmd_proof: crew_card.owner_proof_answer(card, brave=...)
        text = crew_card.owner_proof_answer(card, brave=(mode == "brave"))
        return text.startswith("confirmed proof"), text
    if name == "retry":                         # crew_card cmd_retry: retry_card with its defaults, owner profile
        prof = crew_card.owner_profile()
        res = crew_card.retry_card(card, profile=prof if prof != "default" else None)
        return bool(res["ok"]), crew_card.retry_text(res)
    crew_stop = importlib.import_module("crew_stop")   # _cmd_maintenance("stop", card): crew_stop.py <card>
    try:
        code, text = crew_stop.run([card])
    except SystemExit as exc:
        return False, "stop refused: %s" % exc
    return code == 0, text


@router.post("/action/{name}")
def post_action(name: str, body: dict | None = Body(default=None)):
    body = body if isinstance(body, dict) else {}
    if name not in _ACTION_NAMES:
        return _action_error(400, "unknown action")
    card = body.get("card")
    if not isinstance(card, str) or not _ACK_PATH_RE.match(card):
        return _action_error(400, "Invalid card ID format")
    mode = body.get("mode", "yes")
    if name == "proof" and mode not in ("yes", "brave"):
        return _action_error(400, "proof mode is yes or brave")
    if name == "stop" and body.get("confirm") is not True:
        return _action_error(400, "stop parks the card and kills its run: send confirm true")
    try:
        ok, text = _run_action(name, card, mode)
    except Exception as exc:  # noqa: BLE001 - a button press must answer, never hang the page
        _log.exception("crew dashboard: action %s on %s failed", name, card)
        return JSONResponse(content={"ok": False, "text": "%s failed: %s" % (name, exc)}, headers=dict(_RESPONSE_HEADERS))
    _invalidate()                   # these actions move or rewrite cards: the next poll must not be cached
    return JSONResponse(content={"ok": bool(ok), "text": str(text)}, headers=dict(_RESPONSE_HEADERS))
