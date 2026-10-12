#!/usr/bin/env python3
"""Whether, and how, an unattended proof command may run.

A card's proof command is shell the crew runs with nobody watching: `crew_card.py verdict` (the writer's and
the verifier's run), the coordinator's verify/audit runs, and the stale-block heal all end up in `run_proof`
below, and nowhere else. A proof is not a tool call, so Hermes's approvals never see it; this module puts the
same floors in front of it:

  always   Hermes's hardline list (wiping the root, formatting a disk, fork bombs) and the owner's `approvals.deny` globs
  safe     also anything Hermes flags as dangerous (detect_dangerous_command, unless permanently approved)
           or tirith flags - the default
  brave    nothing else; chosen per card (`Proof mode: brave` in the intake, stored on the card's snapshot)
           or for good (`/crew-safety brave` sets approvals.mode off on the crew profiles)

Any failure to load Hermes's detectors blocks the run: a floor that could not be checked is not a pass.
A blocked proof is not a FAIL: the result says so and the caller asks the owner.

The environment is scrubbed the same way Hermes scrubs a terminal child (provider keys, bot tokens and the
gateway's secrets stay out), so a proof cannot read or leak them.

A proof that runs a script (`python3 /x/site/.crew/verify.py`) is only as good as the file: the first run of each
script on a card records its sha256 on the card, and a later run of a changed script is blocked like any other
refusal (`SCRIPT_CHANGED`) and the coordinator decides (crew_coordinator `revise_script`: it may accept the script or
have the verifier rewrite it, with a reason on record); the writer never writes or changes a proof script.
"""
import glob
import hashlib
import os
import re
import shutil
import subprocess
import sys
from collections import namedtuple

IS_WINDOWS = os.name == "nt"     # a name of its own so a test can pin the Windows branch on Linux
PROOF_MODES = ("safe", "brave")
APPROVED = "approved"            # a mode only proof_mode() returns: safe, but this exact command has the owner's yes
BLOCKED_RC = 126                 # what a shell says for "found but refused"; Result.blocked carries the reason
ENV_KEEP = ("PATH", "HOME", "LANG", "HERMES_HOME", "HERMES_KANBAN_DB", "HERMES_KANBAN_BOARD", "TMPDIR")
HERMES_SRC = (os.environ.get("HERMES_AGENT_SRC") or "", os.path.expanduser("~/.hermes/hermes-agent"))

Result = namedtuple("Result", "rc out blocked")
SCRIPT_CHANGED = "proof script changed since it first ran: "     # the prefix crew_coordinator.proof_blocked_ask keys on
# An absolute script path in a proof command. Relative paths (and ones with spaces) are not bound: they depend on
# the cwd, and the intake writes absolute paths (`<folder>/.crew/verify.py`).
# A script path a proof names: POSIX absolute (/x/site/.crew/verify.py, also Git Bash's /c/Users/...) or a Windows
# drive path (C:/x/verify.py, C:\\x\\verify.py).
SCRIPT_RX = re.compile(r"(?<![\w./~-])((?:[A-Za-z]:[/\\]|/)[^\s'\"`;|&<>()$]+\.(?:py|sh|js))(?![\w/.-])")
_GIT_BASH_DRIVE_RX = re.compile(r"^/([A-Za-z])(?=/)")


def _script_file(path):
    """Where a script path named in a proof is on disk. Git Bash writes C:\\x as /c/x, which Windows Python cannot
    open: without this mapping a script named that way would silently escape the hash binding."""
    if IS_WINDOWS:
        return _GIT_BASH_DRIVE_RX.sub(lambda m: m.group(1).upper() + ":", path)
    return path


def git_bash():
    """The bash a proof runs under on Windows: Git for Windows' own, found from git.exe. Never a bare `bash` on
    PATH (C:\\Windows\\System32\\bash.exe is WSL's, a different machine with different paths), never cmd.exe.
    '' when Git Bash is not installed."""
    git = shutil.which("git")
    if not git:
        return ""
    here = os.path.dirname(git)
    for root in (os.path.dirname(here), os.path.dirname(os.path.dirname(here)), here):
        for rel in (("bin", "bash.exe"), ("usr", "bin", "bash.exe")):
            cand = os.path.join(root, *rel)
            if os.path.isfile(cand):
                return cand
    return ""


def _hermes():
    """Make Hermes's own modules importable (the crew scripts run under any python): its source root goes on
    the path whole, because an editable install exposes the packages but not top-level modules like hermes_yaml.
    Raises ImportError when there is no Hermes."""
    for src in HERMES_SRC:
        if src and os.path.isdir(src) and src not in sys.path:
            sys.path.append(src)
    _venv_deps()
    import tools.approval_detection  # noqa: F401


def _venv_deps():
    """Put Hermes's dependency venv on the path when this interpreter cannot import them itself: under the
    package-manager layout a bare interpreter (cron, the gateway) runs the crew scripts while ruamel and the rest
    live in the venv Hermes commits. Appended last, so anything the bare interpreter has wins."""
    try:
        import ruamel.yaml  # noqa: F401
        return
    except ImportError:
        pass
    import crew_card
    py = crew_card.hermes_python()
    if not py:
        return
    pattern = os.path.join(os.path.dirname(os.path.dirname(py)), "lib", "python*", "site-packages")
    for site in sorted(glob.glob(pattern)):
        if site not in sys.path:
            sys.path.append(site)


def _home_vars(env):
    """Keep a home the child's `Path.home()` can read. The scrub carries HOME (a native Windows process
    never sets it) and drops USERPROFILE/SYSTEMROOT (a native Windows process always has them), and a child
    with neither dies in expanduser before it can load its profile."""
    for key in ("USERPROFILE", "HOMEDRIVE", "HOMEPATH", "SYSTEMROOT", "HOME"):
        if not env.get(key) and os.environ.get(key):
            env[key] = os.environ[key]
    if sys.platform == "win32":
        # Windows expanduser/Path.home reads USERPROFILE (HOME too, for POSIX-style callers), and a native
        # Windows process starts with neither in the scrub. Cross-fill them only here: on POSIX a HOME->
        # USERPROFILE copy would hand every child a bogus Windows username.
        if not env.get("HOME") and env.get("USERPROFILE"):
            env["HOME"] = env["USERPROFILE"]
        if not env.get("USERPROFILE") and env.get("HOME"):
            env["USERPROFILE"] = env["HOME"]
    return env


def proof_env(extra=None):
    """The environment a proof (and the coordinator's own subprocesses) runs with: Hermes's scrubbed child env,
    plus the few variables the crew scripts need to find the board. Never os.environ as it is."""
    try:
        _hermes()
        from tools.environments.local import build_subprocess_env
        env = build_subprocess_env()
    except Exception:  # noqa: BLE001 - no Hermes: the smallest env that still runs a shell command
        env = {k: v for k, v in os.environ.items() if k in ENV_KEEP or k.startswith("CREW_")}
    env.update({k: os.environ[k] for k in ENV_KEEP if k in os.environ})
    _home_vars(env)
    env.update(extra or {})
    return env


def _permanently_approved(key, cmd):
    """Hermes's own 'always allow this' answer for a flagged pattern; unknown -> not approved."""
    try:
        from tools.approval import _is_permanently_approved
        from tools.approval_floors import _command_matches_permanent_allowlist
        return bool(_is_permanently_approved(key) or _command_matches_permanent_allowlist(cmd))
    except Exception:  # noqa: BLE001
        return False


def _tirith_block(cmd):
    """Why tirith stops this command, '' when it does not. A Hermes without the scanner (it was removed from core)
    has nothing to stop it. An unusable scanner follows security.tirith_fail_open exactly as tools/approval.py
    did: open (default) lets it through, closed blocks."""
    try:
        from tools.tirith_security import check_command_security
    except ModuleNotFoundError:
        return ""
    except Exception:  # noqa: BLE001
        check_command_security = None
    try:
        verdict = check_command_security(cmd)
    except Exception:  # noqa: BLE001
        from tools.approval_context import _tirith_fail_open
        return "" if _tirith_fail_open() else "the tirith scanner is unavailable and security.tirith_fail_open is false"
    if verdict.get("action") in ("block", "warn"):
        return "tirith: %s" % (verdict.get("summary") or verdict.get("action"))
    return ""


def cmd_hash(cmd):
    return hashlib.sha256(str(cmd or "").strip().encode()).hexdigest()


def check_proof(cmd, mode="safe"):
    """(ok, reason): may this proof command run unattended in `mode`? `reason` is Hermes's own words when not.
    Mode "approved" (the owner said yes to this exact command) skips the flagged/tirith checks like brave,
    never the hardline and deny floors."""
    try:
        _hermes()
        from tools.approval_detection import detect_dangerous_command, detect_hardline_command
        from tools.approval_floors import _match_user_deny_rule
    except Exception as exc:  # noqa: BLE001
        return False, "Hermes's safety checks could not be loaded (%s: %s), so the proof does not run" % (
            type(exc).__name__, exc)
    try:
        hard, why = detect_hardline_command(cmd)
        if hard:
            return False, "hardline (never runs, even in brave mode): %s" % why
        rule = _match_user_deny_rule(cmd)
        if rule:
            return False, "matches your approvals.deny rule '%s' (never runs, even in brave mode)" % rule
        if mode in ("brave", APPROVED):
            return True, ""
        flagged, key, desc = detect_dangerous_command(cmd)
        if flagged and not _permanently_approved(key, cmd):
            return False, "flagged by Hermes as dangerous: %s" % desc
        tirith = _tirith_block(cmd)
        if tirith:
            return False, tirith
    except Exception as exc:  # noqa: BLE001 - a detector that crashes has not cleared the command
        return False, "Hermes's safety check failed (%s: %s), so the proof does not run" % (type(exc).__name__, exc)
    return True, ""


def proof_check(cmd):
    """The intake's pre-ask check, one line: `ok`, `flagged: <Hermes's reason>` (safe mode would stop it) or
    `hardline: <reason>` (never runs, in any mode). Same logic as check_proof, read-only."""
    floor_ok, floor_why = check_proof(cmd, "brave")
    if not floor_ok:
        return "hardline: %s" % floor_why.replace("hardline (never runs, even in brave mode): ", "")
    ok, why = check_proof(cmd, "safe")
    return "ok" if ok else "flagged: %s" % why.replace("flagged by Hermes as dangerous: ", "")


def permanent_mode():
    """"brave" when the crew-coordinator profile's Hermes approvals.mode is off (set for good by
    `/crew-safety brave`), else "safe". The coordinator profile is the one that runs proofs unattended."""
    import crew_card
    mode = crew_card.config_value("mode", section="approvals",
                                  home=crew_card.profile_home(crew_card.role_profile("coordinator")))
    return "brave" if (mode or "").strip().lower() in ("off", "false") else "safe"


def proof_mode(card_id, cmd=None):
    """The mode a card's proof runs in: "brave" when its snapshot records the owner's per-card choice or the
    permanent mode is brave; "approved" when `cmd` is exactly a command the owner approved while Hermes flagged
    it (a hash in the snapshot: any other command, e.g. after a rescope, is not); else "safe"."""
    import crew_card
    if crew_card.proof_snapshot_mode(card_id) == "brave" or permanent_mode() == "brave":
        return "brave"
    if cmd and cmd_hash(cmd) in crew_card.proof_snapshot_approved(card_id):
        return APPROVED
    return "safe"


def script_hashes(cmd):
    """{path: sha256 of its bytes} for every script file the proof command names that exists right now."""
    out = {}
    for path in SCRIPT_RX.findall(str(cmd or "")):
        try:
            with open(_script_file(path), "rb") as fh:
                out[path] = hashlib.sha256(fh.read()).hexdigest()
        except OSError:
            continue
    return out


def script_change(card_id, cmd, record=False):
    """Why this card's proof scripts may not run, '' when they may: a script whose hash differs from the recorded
    one, unless the coordinator authorized a revision (then the new hash is recorded with that reason). With
    `record`, a script not seen before gets its hash recorded now (the first run binds it)."""
    import crew_card
    known = crew_card.proof_script_hashes(card_id)
    now = script_hashes(cmd)
    changed = sorted(p for p, h in now.items() if p in known and known[p] != h)
    why = crew_card.pending_script_authorization(card_id) if changed else ""
    if changed and not why:
        return SCRIPT_CHANGED + ", ".join(changed)
    if record:
        crew_card.record_script_hashes(card_id, {p: h for p, h in now.items() if p not in known or p in changed},
                                       by="verifier" if why else "crew", why=why,
                                       authorized_by=crew_card.decision_id(card_id, "revise_script") if why else None)
    return ""


def is_script_block(reason):
    return str(reason or "").startswith(SCRIPT_CHANGED)


def run_proof(cmd, cwd=None, timeout=300, mode="safe", card=None):
    """The one runner of a proof command. Result(rc, output, blocked): `blocked` is the reason the safety floor
    (or, with `card`, the card's recorded script hashes) refused it (nothing ran, rc is BLOCKED_RC); rc 124 is a
    timeout, 127 a command that could not start. Every unattended proof comes through here, so the script binding
    lives here and not in one caller."""
    ok, why = check_proof(cmd, mode)
    if ok and card:
        why = script_change(card, cmd, record=True)
        ok = not why
    if not ok:
        return Result(BLOCKED_RC, why, why)
    argv = cmd
    if IS_WINDOWS:
        # A proof is bash. cmd.exe reads `echo hi; exit 3`, `sleep` and `rm` differently, and a safety check that
        # judged the bash text would then guard something other than what runs.
        bash = git_bash()
        if not bash:
            return Result(127, "Git Bash was not found next to git.exe: crew proofs run in Git Bash on Windows "
                               "(install Git for Windows); the proof was not run", "")
        argv = [bash, "-c", cmd]
    try:
        done = subprocess.run(argv, shell=not IS_WINDOWS, capture_output=True, text=True, timeout=timeout, cwd=cwd,
                              env=proof_env(), encoding="utf-8", errors="replace")
        return Result(done.returncode, (done.stdout or "") + (done.stderr or ""), "")
    except subprocess.TimeoutExpired:
        return Result(124, "proof command timed out after %ss" % timeout, "")
    except OSError as exc:
        return Result(127, str(exc), "")
