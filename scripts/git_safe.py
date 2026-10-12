"""Hardened git for crew tooling: a repository may not run its own code in our process.

Why this file exists. Every crew script shells out to git. A repository can carry, in its own
.git/config or .gitattributes, a program that git then runs for us: ``core.fsmonitor``, a hook
found by ``core.hooksPath``, ``diff.external``, a ``textconv=`` driver, and ``filter.*.clean`` /
``smudge`` / ``process``. In September 2026 that class (GitSpawn, Manifold Security) was shown to
execute attacker code in seven coding harnesses - Hermes Agent among them - before any approval.
crew is our own plugin, so a crew script must never call bare ``git`` on a repository it did not
create (``pr_scan --git REPO`` takes a path from the command line).

Two layers, the same two Hermes uses for its own probes (``hermes_cli/_subprocess_compat.py``):

1. :func:`git_env` - a pinned config block over a blanked global/system config: no fsmonitor, no
   hooks path, no pager/editor, no credential or askpass program, ssh in BatchMode. The
   repository's own filter driver names are enumerated and their commands neutralized, because
   ``.gitattributes`` names them and the environment cannot enumerate what it does not read.
   Fail-closed: ``None`` means "this repository cannot be trusted, do not run git here".
2. :func:`git_argv` - ``--no-ext-diff --no-textconv`` after a diff-rendering subcommand, the one
   class the environment cannot reach (the attacker names the attribute, not the key).

Hermes' implementation is used when it is importable (in-process plugin runs); the vendored
fallback below is what actually runs from ``python3`` or the dev venv, where ``hermes_cli`` is not
on the path - so the fallback carries the full hardening, never a weaker one.
"""
import os
import re
import subprocess
import sys

NO_DRIVER_DIFF_FLAGS = ("--no-ext-diff", "--no-textconv")
FILTER_DISCOVERY_FAILED = "git filter discovery failed"

# Only these subcommands accept NO_DRIVER_DIFF_FLAGS (``status`` and friends reject them).
_DIFF_RENDERING = frozenset({"diff", "show", "log", "blame"})
# Options that consume the FOLLOWING token, so a value is never mistaken for the subcommand.
_VALUE_OPTS = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"}

_FILTER_COMMAND_KEY = re.compile(r"^filter\..+\.(?:clean|smudge|process)$", re.IGNORECASE)
_INCLUDE_KEY = re.compile(r"^include(?:if\..*)?\.path$", re.IGNORECASE)
_DISCOVERY_KEYS_REGEXP = r"^(filter\..*\.(clean|smudge|process)|include\.path|includeif\..*\.path)$"

# Each discovered key costs two env entries; a repo with tens of thousands of filters would make
# every spawn fail with E2BIG, so refuse past a generous cap instead.
_MAX_FILTER_KEYS = 256
_PROBE_TIMEOUT = 5.0

# Fixed pins. Distinct keys from the discovered filter.* ones, so order between the two groups
# does not matter: whichever is written last, both are in force.
_OVERRIDES = (
    ("credential.helper", ""),
    ("core.askPass", ""),
    ("core.fsmonitor", "false"),
    ("core.untrackedCache", "false"),
    ("core.hooksPath", os.devnull),
    ("core.pager", "cat"),
    ("core.editor", "true"),
    ("sequence.editor", "true"),
    ("diff.external", ""),
    # ssh bypasses stdin=DEVNULL and GIT_TERMINAL_PROMPT and opens /dev/tty directly; BatchMode
    # makes it fail instead of prompting, and a working ssh-agent still succeeds.
    ("core.sshCommand", "ssh -o BatchMode=yes"),
)

_HERMES = None       # None = not probed yet, False = probed and absent, module = available
_HERMES_PROBED = False


class GitRefused(RuntimeError):
    """Raised instead of running git in a repository whose config could not be trusted."""


def _hermes():
    """Hermes' own hardening module, or None when this is not running inside a Hermes install."""
    global _HERMES, _HERMES_PROBED
    if not _HERMES_PROBED:
        _HERMES_PROBED = True
        try:
            import hermes_cli._subprocess_compat as mod  # noqa: WPS433 - optional, by design
            _HERMES = mod
        except Exception:  # noqa: BLE001 - any import failure means "use the vendored copy"
            _HERMES = False
    return _HERMES or None


def _pinned_env(base=None):
    env = dict(base if base is not None else os.environ)
    # Drop caller-supplied config injection: the block below is rebuilt from scratch, so ambient
    # -c values (GIT_CONFIG_COUNT/KEY_n/VALUE_n, GIT_CONFIG_PARAMETERS) cannot re-enable a sink.
    for key in list(env):
        if key == "GIT_CONFIG_PARAMETERS" or key == "GIT_CONFIG_COUNT" \
                or key.startswith("GIT_CONFIG_KEY_") or key.startswith("GIT_CONFIG_VALUE_"):
            env.pop(key, None)
    env.update({
        "GIT_TERMINAL_PROMPT": "0",
        "GCM_INTERACTIVE": "Never",
        "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_CONFIG_SYSTEM": os.devnull,
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_PAGER": "cat",
        "PAGER": "cat",
        "GIT_EDITOR": "true",
    })
    return env


def _apply_overrides(env, pairs):
    start = int(env.get("GIT_CONFIG_COUNT") or 0)
    for offset, (key, value) in enumerate(pairs):
        env["GIT_CONFIG_KEY_%d" % (start + offset)] = key
        env["GIT_CONFIG_VALUE_%d" % (start + offset)] = value
    env["GIT_CONFIG_COUNT"] = str(start + len(pairs))


def _probe(args, env, timeout=_PROBE_TIMEOUT):
    try:
        return subprocess.run(["git"] + list(args), env=env, stdin=subprocess.DEVNULL,
                              capture_output=True, text=True, timeout=timeout, encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001 - a probe that cannot run is a refusal, not a crash
        return None


def _filter_overrides(repo, env):
    """Empty command overrides for every filter driver this repository configures, or None.

    ``.gitattributes`` names a driver (``* filter=evil``) and the repo config defines what it runs,
    so the environment can only be closed by reading the config. An ``include`` can declare more
    filters than the file we are looking at, so any include key is refused outright rather than
    followed - crew's repos have none, and a refusal is louder than a half-read config.
    """
    proc = _probe(["-C", repo, "config", "--local", "--name-only", "-z", "--get-regexp",
                   _DISCOVERY_KEYS_REGEXP], env)
    if proc is None or proc.returncode not in (0, 1):
        # 128 = not a git directory (nothing to neutralize); anything else means the discovery
        # itself could not be trusted, and partial hardening is not hardening.
        return [] if proc is not None and proc.returncode == 128 else None
    names = [name.strip() for name in proc.stdout.split("\0") if name.strip()]
    if any(_INCLUDE_KEY.fullmatch(name) for name in names):
        return None
    keys, required, seen = [], [], set()
    for name in names:
        if name in seen or not _FILTER_COMMAND_KEY.fullmatch(name):
            continue
        seen.add(name)
        keys.append(name)
        required_key = name.rsplit(".", 1)[0] + ".required"
        if required_key not in seen:
            seen.add(required_key)
            required.append(required_key)
    if len(keys) > _MAX_FILTER_KEYS:
        return None
    # An empty command is "no filter"; required=false makes a driver whose command we emptied fail
    # open (git warns and keeps the file as-is) instead of aborting the operation.
    return [(key, "") for key in keys] + [(key, "false") for key in required]


def git_env(repo=None, base=None):
    """Hardened environment for one git call in *repo*, or None = refuse to run git there."""
    hermes = _hermes()
    path = str(repo) if repo is not None else os.getcwd()
    if hermes is not None:
        try:
            return hermes.noninteractive_repo_git_env(path, base)
        except Exception:  # noqa: BLE001 - never harden by accident: fall through to the copy
            return None
    env = _pinned_env(base)
    extra = _filter_overrides(path, env)
    if extra is None:
        return None
    _apply_overrides(env, list(_OVERRIDES))
    _apply_overrides(env, extra)
    return env


def git_argv(args):
    """Full argv (starting with ``git``) with the attribute-driver flags where git accepts them."""
    argv = list(args)
    if not argv or os.path.basename(argv[0]) not in ("git", "git.exe"):
        return argv
    hermes = _hermes()
    if hermes is not None:
        try:
            return [argv[0]] + list(hermes.harden_git_argv(argv[1:]))
        except Exception:  # noqa: BLE001
            pass
    i = 1
    while i < len(argv):
        tok = argv[i]
        if tok in _VALUE_OPTS:
            i += 2
            continue
        if tok.startswith("-"):
            i += 1
            continue
        if tok in _DIFF_RENDERING:
            return argv[:i + 1] + list(NO_DRIVER_DIFF_FLAGS) + argv[i + 1:]
        return argv  # first non-option token is a non-diff subcommand
    return argv


def _repo_hint(args, cwd, repo):
    """Which repository a call touches: an explicit hint, then ``-C <path>``, then the cwd."""
    if repo is not None:
        return str(repo)
    argv = list(args)
    for i, tok in enumerate(argv[:-1]):
        if tok == "-C" and i > 0:
            return str(argv[i + 1])
    return str(cwd) if cwd is not None else os.getcwd()


def run_git(args, cwd=None, repo=None, env=None, timeout=120, **kwargs):
    """subprocess.run for git, hardened. Raises GitRefused when the repo cannot be trusted."""
    target = _repo_hint(args, cwd, repo)
    genv = env if env is not None else git_env(target)
    if genv is None:
        raise GitRefused("refusing to run git in %s: %s" % (target, FILTER_DISCOVERY_FAILED))
    kwargs.setdefault("stdin", subprocess.DEVNULL)
    return subprocess.run(git_argv(args), cwd=cwd, env=genv, timeout=timeout, **kwargs)


def popen_git(args, cwd=None, repo=None, env=None, **kwargs):
    """subprocess.Popen for git, hardened (streaming call sites: ``git archive``)."""
    target = _repo_hint(args, cwd, repo)
    genv = env if env is not None else git_env(target)
    if genv is None:
        raise GitRefused("refusing to run git in %s: %s" % (target, FILTER_DISCOVERY_FAILED))
    kwargs.setdefault("stdin", subprocess.DEVNULL)
    return subprocess.Popen(git_argv(args), cwd=cwd, env=genv, **kwargs)


if __name__ == "__main__":  # a one-line self-check: which layer is active here
    print("hermes layer:", bool(_hermes()), "| python:", sys.version.split()[0])
    print("argv:", git_env(os.getcwd()) is not None)
