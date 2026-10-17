#!/usr/bin/env python3
"""Proof for the token section on a crew card page (left rail, fixed positions).

Done when: every card page renders a `#toksec` block at the top of `#rail` (the roles are a strip outside it), with
five rows carrying these exact ids in this exact DOM order:

    #tokCeiling   the card ceiling in weighed tokens
    #tokUsed      billed tokens spent, summed over every ledger file for the card
    #tokRaw       raw total_tokens, summed the same way
    #tokCalls     api call count, summed the same way
    #tokPct       used/ceiling as a percentage with one decimal and a percent sign

and each shown number equals the ledger figure, printed exactly (thousands separators, never
shortened to k/M). Ledger figures, over the base home and every profile home, for `<card>.json`
and `<card>.json.spent`:
    ceiling = max(budget)          used = sum(used)          raw = sum(raw_total)
    calls   = sum(calls)           pct  = round(100*used/ceiling, 1)

Exit 0 = every checked card page agrees with its ledgers. Non-zero = it does not, and the failing
check is printed. By default it seeds one throwaway probe card per state on the proofs board, with ledger
files of known figures, checks those pages on a dashboard of its own, and archives the cards and deletes
the ledgers afterwards - so it passes on a fresh install too. --live / --cards read real cards instead
(read-only, the live dashboard on :8799). Pages open in headless Chrome over the DevTools protocol.
"""
import argparse
import importlib.util
import json
import os
import re
import shutil
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import crew_card  # noqa: E402 - Hermes's home for this platform
import crew_proof_board  # noqa: E402
ROW_ORDER = ["tokCeiling", "tokUsed", "tokRaw", "tokCalls", "tokPct"]
ROW_WORDS = {"tokCeiling": "ceiling", "tokUsed": "used", "tokRaw": "raw", "tokCalls": "calls",
             "tokPct": "pct"}
STATES = ["running", "review", "blocked", "done"]
CHROME = crew_proof_board.find_chrome()
PORT = 9334


def crew_module():
    spec = importlib.util.spec_from_file_location("cg", os.path.join(HERE, "crew_graph.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def ledger_totals(card_id):
    """(ceiling, used, raw, calls) over every ledger file recorded for this card."""
    base = crew_card.hermes_home()
    base = os.path.abspath(base)
    parent = os.path.dirname(base.rstrip(os.sep))
    if os.path.basename(parent) == "profiles":
        base = os.path.dirname(parent)
    homes = [base]
    profdir = os.path.join(base, "profiles")
    if os.path.isdir(profdir):
        homes += [os.path.join(profdir, n) for n in sorted(os.listdir(profdir))]
    ceiling = used = raw = calls = 0
    for home in homes:
        for suffix in ("", ".spent"):
            path = os.path.join(home, "crew", "budget", card_id + ".json" + suffix)
            try:
                with open(path, encoding="utf-8") as fh:
                    data = json.load(fh)
            except Exception:
                continue
            ceiling = max(ceiling, int(data.get("budget") or 0))
            used += int(data.get("used") or 0)
            raw += int(data.get("raw_total") or 0)
            calls += int(data.get("calls") or 0)
    return ceiling, used, raw, calls


def pick_cards(db, wanted):
    """One card id per requested state, newest first (--live: the owner's real cards)."""
    out = {}
    conn = sqlite3.connect("file:%s?mode=ro" % db, uri=True)
    try:
        for state in wanted:
            row = conn.execute(
                "select id from tasks where status = ? order by rowid desc limit 1",
                (state,)).fetchone()
            if row:
                out[state] = row[0]
    finally:
        conn.close()
    return out


# A throwaway card per state, with a ledger of known figures split over the two files the page sums
# (<card>.json and <card>.json.spent), so the proof passes or fails on the page alone - not on whether
# this box happens to have a card in every state (issue #15: a fresh Windows board had none, and the
# proof failed with "no card page to check").
SEED_LEDGER = ({"budget": 200000, "used": 31234, "raw_total": 45678, "calls": 7},
               {"budget": 150000, "used": 1111, "raw_total": 2222, "calls": 3})


def seed_cards(db, states):
    """{state: card} seeded on the proofs board (unclaimable fixture assignee, probe owner) and the ledger
    files written for each. Returns (board, files) so the caller can drop both."""
    import random
    import string
    board, files = {}, []
    now = int(time.time())
    budget_dir = os.path.join(crew_card.base_home(), "crew", "budget")
    os.makedirs(budget_dir, exist_ok=True)
    conn = sqlite3.connect(db)
    try:
        for state in states:
            card = "t_" + "".join(random.choice(string.hexdigits[:16]) for _ in range(8))
            conn.execute(
                "insert into tasks (id, title, body, assignee, status, priority, created_by, created_at, "
                "workspace_kind) values (?, ?, ?, ?, ?, 0, ?, ?, 'scratch')",
                (card, "PROBE token section %s %d" % (state, now),
                 "Coordinator: %s/\nGoal: probe card for the token section\nRole: worker\n"
                 "proof command: true\n" % crew_card.owner_profile(),
                 crew_card.FIXTURE_ASSIGNEE, state, crew_card.PROBE_OWNER, now))
            conn.execute(
                "insert into task_runs (task_id, profile, status, started_at, ended_at, outcome, summary, "
                "last_heartbeat_at) values (?, 'crew-worker', 'blocked', ?, ?, 'blocked', 'probe run', ?)",
                (card, now - 300, now - 240, now - 240))
            for suffix, data in zip(("", ".spent"), SEED_LEDGER):
                path = os.path.join(budget_dir, card + ".json" + suffix)
                with open(path, "w", encoding="utf-8") as fh:
                    json.dump(data, fh)
                files.append(path)
            board[state] = card
        conn.commit()
    finally:
        conn.close()
    return board, files


def drop_seed(db, board, files):
    conn = sqlite3.connect(db)
    try:
        for card in board.values():
            conn.execute("update tasks set status = 'archived' where id = ?", (card,))
        conn.commit()
    finally:
        conn.close()
    for path in files:
        try:
            os.remove(path)
        except OSError:
            pass


def http_json(path):
    with urllib.request.urlopen("http://127.0.0.1:%d%s" % (PORT, path), timeout=10) as fh:
        return json.loads(fh.read().decode())


def wait_for_target(fragment, tries=40):
    for _ in range(tries):
        try:
            for t in http_json("/json/list"):
                if t.get("type") == "page" and fragment in (t.get("url") or ""):
                    return t
        except Exception:
            pass
        time.sleep(0.5)
    return None


def digits(text):
    m = re.findall(r"-?\d[\d,]*", str(text or ""))
    if not m:
        return None
    try:
        return int(m[0].replace(",", ""))
    except ValueError:
        return None


def number(text):
    """First number in the text, decimals kept: '17.9%' reads as 17.9, '3,249,014' as 3249014."""
    m = re.search(r"-?\d[\d,]*(?:\.\d+)?", str(text or ""))
    if not m:
        return None
    try:
        return float(m.group(0).replace(",", ""))
    except ValueError:
        return None


JS = """
(function(){
  var rail = document.getElementById('rail'), block = document.getElementById('toksec'),
      roster = document.getElementById('roster');
  var rows = block ? Array.prototype.map.call(
      block.querySelectorAll('.tokrow, [id^="tok"]'),
      function(e){ return e.id; }).filter(function(i){ return i && i !== 'toksec'; }) : [];
  var nums = {};
  ['tokCeiling','tokUsed','tokRaw','tokCalls','tokPct'].forEach(function(id){
    var e = document.getElementById(id);
    nums[id] = e ? e.textContent : null;
  });
  var before = false;
  if (rail && block && block.parentNode) {
    // the token block leads the rail; the roles live in their own strip, never inside the rail
    before = rail.firstElementChild === block && !(roster && rail.contains(roster));
  }
  return {rail: !!rail, roster: !!roster, block: !!block, inRail: !!document.querySelector('#rail #toksec'),
          beforeRoster: before, rows: rows, nums: nums, text: block ? block.textContent.slice(0,300) : ''};
})()
"""


def check_card(ws, host, card):
    """Returns [(name, ok, detail)] for one card page."""
    ws.call(1, "Page.navigate", {"url": "http://%s/card/%s" % (host, card)})
    seen = False
    for _ in range(40):
        try:
            if ws.evaluate("!!document.getElementById('toksec')"):
                seen = True
                break
        except Exception:
            pass
        time.sleep(0.5)
    state = ws.evaluate(JS) or {}
    ceiling, used, raw, calls = ledger_totals(card)

    rows = state.get("rows") or []
    got_rows = [r for r in rows if r in ROW_ORDER]
    extra = [r for r in rows if r not in ROW_ORDER]

    checks = []
    checks.append(("block present in the rail", bool(state.get("inRail"))))
    checks.append(("block leads the rail, the roles are not in it", bool(state.get("beforeRoster"))))
    checks.append(("row ids in fixed order %s" % " > ".join(ROW_ORDER),
                   got_rows == ROW_ORDER))
    if extra:
        checks.append(("no extra token rows (%s)" % ",".join(extra[:3]), False))

    nums = state.get("nums") or {}
    shown = {k: digits(nums.get(k)) for k in ROW_ORDER}
    want = {"tokCeiling": ceiling, "tokUsed": used, "tokRaw": raw, "tokCalls": calls}
    for key in ("tokCeiling", "tokUsed", "tokRaw", "tokCalls"):
        checks.append(("%s shows %s" % (ROW_WORDS[key], format(want[key], ",")),
                       shown.get(key) == want[key]))
    pct_text = nums.get("tokPct") or ""
    want_pct = round(100.0 * used / ceiling, 1) if ceiling else 0.0
    got_pct = number(pct_text)
    checks.append(("pct shows %s%%" % want_pct,
                   got_pct is not None and abs(got_pct - want_pct) <= 0.15
                   and "%" in str(pct_text)))
    if not seen:
        checks.append(("block appeared without interaction", False))
    return checks


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default=None,
                    help="dashboard host:port (default: a server of its own on the proofs board; --live: 127.0.0.1:8799)")
    ap.add_argument("--cards", default=None, help="comma-separated card ids on the live board (implies --live)")
    ap.add_argument("--live", action="store_true",
                    help="check the newest real card per state on the live board instead of seeded probe cards")
    ap.add_argument("--states", default=",".join(STATES))
    args = ap.parse_args()
    states = [s for s in args.states.split(",") if s]
    live = args.live or bool(args.cards)

    if not CHROME:
        print("PROOF FAIL: no chrome binary to render the page with")
        return 2
    seeded, files, db = {}, [], ""
    if live:
        try:
            board = pick_cards(crew_module().kanban_db_path(), states)
        except Exception as exc:  # noqa: BLE001
            print("PROOF FAIL: cannot read the board (%s)" % exc)
            return 2
        host = args.host or "127.0.0.1:8799"
    else:
        db = crew_proof_board.proof_db()
        seeded, files = seed_cards(db, states)
        board = seeded
        host = args.host or crew_proof_board.graph_base().split("://", 1)[-1]
    try:
        return check_pages(args, board, host, states)
    finally:
        if seeded:
            drop_seed(db, seeded, files)


def check_pages(args, board, host, states):
    cards = ([c.strip() for c in args.cards.split(",") if c.strip()] if args.cards
             else [board[s] for s in states if s in board])
    if not cards:
        print("PROOF FAIL: no card page to check")
        return 2

    url = "http://%s/card/%s" % (host, cards[0])
    profile = tempfile.mkdtemp(prefix="crew-tokens-")
    proc = subprocess.Popen(
        [CHROME, "--headless=new", "--password-store=basic", "--disable-gpu", "--no-sandbox",
         "--remote-debugging-port=%d" % PORT, "--user-data-dir=" + profile,
         "--window-size=1400,900", url],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        start_new_session=True)
    failures = []
    covered = 0
    try:
        target = wait_for_target("/card/")
        if not target:
            print("PROOF FAIL: the page never loaded")
            return 2
        sys.path.insert(0, HERE)
        from crew_ws import WSClient
        ws = WSClient(target["webSocketDebuggerUrl"])
        try:
            for card in cards:
                state = [s for s, c in board.items() if c == card]
                covered += 1
                for name, ok in check_card(ws, host, card):
                    print("%-42s %s  %s" % (name, "PASS" if ok else "FAIL",
                                            "%s %s" % (card, state[0] if state else "")))
                    if not ok:
                        failures.append("%s: %s" % (card, name))
        finally:
            ws.close()
    finally:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except Exception:                                          # noqa: BLE001
            proc.terminate()
        try:
            proc.wait(timeout=10)
        except Exception:
            proc.kill()
        shutil.rmtree(profile, ignore_errors=True)

    if failures:
        print("PROOF FAIL: %d check(s) failed on %d card page(s): %s"
              % (len(failures), covered, "; ".join(failures[:4])))
        return 1
    print("PROOF OK: token block fixed in the rail on %d card page(s), figures match the ledgers"
          % covered)
    return 0


if __name__ == "__main__":
    sys.exit(main())
