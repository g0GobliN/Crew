"""The GitSpawn class, proved in both directions on crew's own git helper.

A repository can carry a program of its own in .git/config (core.fsmonitor, core.hooksPath,
diff.external, filter.*.clean) and name it from .gitattributes. Every case below is armed in a
throwaway repository and run twice:

  * control  - a bare `git` subprocess in that repo MUST run the program (this is what proves the
               test has teeth; a test that passes because nothing ever fires proves nothing);
  * hardened - git_safe.run_git() in the same repo MUST NOT.

Plus the refusal path (a config we cannot read fully is refused, not half-hardened) and the adapter
that defers to Hermes' own hardening when it is importable.
"""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

TESTS = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(TESTS)
sys.path.insert(0, os.path.join(REPO, "dev"))

import git_safe  # noqa: E402


def _git(args, cwd, env=None):
    return subprocess.run(["git"] + list(args), cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                          capture_output=True, text=True, timeout=60)


class AttackRepo:
    """A throwaway git repository, a marker file, and a program that touches the marker."""

    def __init__(self, tmp):
        self.root = Path(tmp) / "attack"
        self.root.mkdir(parents=True)
        self.marker = Path(tmp) / "MARKER"
        self.program = Path(tmp) / "payload.sh"
        self.program.write_text("#!/bin/sh\necho ran >> %s\nexit 0\n" % self.marker)
        self.program.chmod(0o755)
        _git(["-c", "init.defaultBranch=main", "init", "-q"], self.root)
        _git(["config", "user.email", "crew@example.invalid"], self.root)
        _git(["config", "user.name", "crew test"], self.root)

    def config(self, key, value):
        _git(["config", key, value], self.root)

    def fired(self):
        return self.marker.exists()

    def clear(self):
        if self.marker.exists():
            self.marker.unlink()

    def commit_file(self, name="f.txt", body="one\n"):
        (self.root / name).write_text(body)
        subprocess.run(["git", "add", "-A"], cwd=self.root, capture_output=True, check=True)
        subprocess.run(["git", "commit", "-q", "-m", "base"], cwd=self.root,
                       capture_output=True, check=True)


class GitSpawnTests(unittest.TestCase):
    """One case per execution sink, each proved to fire before it is proved to be closed."""

    def _attack(self, kind):
        tmp = tempfile.mkdtemp(prefix="crew-git-safe-")
        repo = AttackRepo(tmp)
        if kind == "fsmonitor":
            repo.config("core.fsmonitor", str(repo.program))
        elif kind == "hooks":
            hooks = Path(tmp) / "hooks"
            hooks.mkdir()
            hook = hooks / "post-index-change"
            hook.write_text("#!/bin/sh\necho ran >> %s\nexit 0\n" % repo.marker)
            hook.chmod(0o755)
            repo.config("core.hooksPath", str(hooks))
        elif kind == "diff.external":
            repo.commit_file()
            repo.config("diff.external", str(repo.program))
        elif kind == "filter":
            (repo.root / ".gitattributes").write_text("* filter=evil\n")
            repo.config("filter.evil.clean", str(repo.program))
        return repo

    def _hardened(self, repo, args, **kwargs):
        return git_safe.run_git(["git"] + args, cwd=str(repo.root), capture_output=True, text=True,
                                timeout=60, **kwargs)

    def test_fsmonitor_config_never_runs_under_git_safe(self):
        repo = self._attack("fsmonitor")
        subprocess.run(["git", "status"], cwd=repo.root, capture_output=True, timeout=60)
        self.assertTrue(repo.fired(), "control: bare git status must run core.fsmonitor")
        repo.clear()
        self._hardened(repo, ["status"], check=True)
        self.assertFalse(repo.fired(), "git_safe must not run core.fsmonitor")

    def test_hooks_path_never_runs_under_git_safe(self):
        repo = self._attack("hooks")
        (repo.root / "h.txt").write_text("payload\n")
        # post-index-change is an index-write hook: the control writes the index with bare git.
        subprocess.run(["git", "add", "-A"], cwd=repo.root, capture_output=True, timeout=60)
        self.assertTrue(repo.fired(), "control: the hooksPath hook must run for bare git")
        repo.clear()
        (repo.root / "h.txt").write_text("payload two\n")
        proc = self._hardened(repo, ["add", "-A"])
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertFalse(repo.fired(), "git_safe must not run a repo-configured hook")

    def test_external_diff_never_runs_under_git_safe(self):
        repo = self._attack("diff.external")
        (repo.root / "f.txt").write_text("two\n")
        subprocess.run(["git", "diff"], cwd=repo.root, capture_output=True, timeout=60)
        self.assertTrue(repo.fired(), "control: bare git diff must run diff.external")
        repo.clear()
        self._hardened(repo, ["diff"])
        self.assertFalse(repo.fired(), "git_safe must not run diff.external")

    def test_filter_driver_never_runs_under_git_safe(self):
        repo = self._attack("filter")
        (repo.root / "g.txt").write_text("payload\n")
        subprocess.run(["git", "add", "-A"], cwd=repo.root, capture_output=True, timeout=60)
        self.assertTrue(repo.fired(), "control: bare git add must run the clean filter")
        repo.clear()
        proc = self._hardened(repo, ["add", "-A"])
        self.assertFalse(repo.fired(), "git_safe must neutralize filter.evil.clean")
        self.assertEqual(proc.returncode, 0, proc.stderr)

    def test_hostile_inherited_config_injection_is_dropped(self):
        """GIT_CONFIG_KEY_n in the ambient env is how an attacker re-arms a sink we just pinned."""
        repo = self._attack("fsmonitor")
        base = dict(os.environ)
        base["GIT_CONFIG_COUNT"] = "1"
        base["GIT_CONFIG_KEY_0"] = "core.fsmonitor"
        base["GIT_CONFIG_VALUE_0"] = str(repo.program)
        env = git_safe.git_env(str(repo.root), base)
        self.assertIsNotNone(env)
        self._hardened(repo, ["status"], env=env, check=True)
        self.assertFalse(repo.fired(), "an inherited -c injection must not survive git_env")

    def test_unreadable_config_is_refused_not_half_hardened(self):
        """An include can hide anything, so a repo that has one is refused outright."""
        repo = self._attack("fsmonitor")
        other = repo.root.parent / "extra.inc"
        other.write_text("[filter \"evil\"]\n\tclean = %s\n" % repo.program)
        repo.config("include.path", str(other))
        self.assertIsNone(git_safe.git_env(str(repo.root)))
        with self.assertRaises(git_safe.GitRefused):
            self._hardened(repo, ["status"])
        self.assertFalse(repo.fired())

    def test_a_clean_repo_is_not_refused(self):
        """The hardening must not close crew's own repositories: no filters, no includes, runs."""
        tmp = tempfile.mkdtemp(prefix="crew-git-safe-clean-")
        repo = AttackRepo(tmp)
        repo.commit_file()
        self.assertIsNotNone(git_safe.git_env(str(repo.root)))
        proc = self._hardened(repo, ["status", "--porcelain"], check=True)
        self.assertEqual(proc.stdout.strip(), "")


class ArgvHardeningTests(unittest.TestCase):
    """The attribute-driver flags: git accepts them only on diff-rendering subcommands."""

    def test_flags_land_after_a_diff_rendering_subcommand(self):
        for sub in ("diff", "show", "log", "blame"):
            argv = git_safe.git_argv(["git", sub, "HEAD"])
            self.assertEqual(argv[1], sub)
            self.assertEqual(argv[2:4], list(git_safe.NO_DRIVER_DIFF_FLAGS))

    def test_flags_land_after_dash_C_and_before_the_range(self):
        argv = git_safe.git_argv(["git", "-C", "/some/repo", "diff", "A..B"])
        self.assertEqual(argv, ["git", "-C", "/some/repo", "diff", "--no-ext-diff", "--no-textconv",
                                "A..B"])

    def test_a_commit_is_left_alone(self):
        argv = ["git", "-c", "user.name=x", "commit", "-q", "-m", "msg"]
        self.assertEqual(git_safe.git_argv(argv), argv)

    def test_a_value_option_is_never_mistaken_for_the_subcommand(self):
        # `-C diff` names a path; the real subcommand is what follows it.
        argv = git_safe.git_argv(["git", "-C", "diff", "status"])
        self.assertEqual(argv, ["git", "-C", "diff", "status"])


class HermesAdapterTests(unittest.TestCase):
    """Inside Hermes the helper uses Hermes' own hardening; the vendored copy is the fallback."""

    def setUp(self):
        self._saved = (git_safe._HERMES, git_safe._HERMES_PROBED)
        git_safe._HERMES_PROBED = True

    def tearDown(self):
        git_safe._HERMES, git_safe._HERMES_PROBED = self._saved

    class _Fake:
        @staticmethod
        def noninteractive_repo_git_env(path, base=None):
            env = dict(base or {})
            env["FAKE"] = path
            return env

        @staticmethod
        def harden_git_argv(args):
            return list(args) + ["--from-hermes"]

    def test_hermes_layer_wins_when_importable(self):
        git_safe._HERMES = self._Fake
        env = git_safe.git_env("/tmp/somewhere")
        self.assertEqual(env["FAKE"], "/tmp/somewhere")
        self.assertEqual(git_safe.git_argv(["git", "diff"]), ["git", "diff", "--from-hermes"])

    def test_hermes_refusal_is_a_refusal(self):
        class Refusing(self._Fake):
            @staticmethod
            def noninteractive_repo_git_env(path, base=None):
                return None

        git_safe._HERMES = Refusing
        self.assertIsNone(git_safe.git_env("/tmp/somewhere"))

    def test_hermes_raising_falls_through_to_a_refusal(self):
        class Broken(self._Fake):
            @staticmethod
            def noninteractive_repo_git_env(path, base=None):
                raise RuntimeError("boom")

        git_safe._HERMES = Broken
        self.assertIsNone(git_safe.git_env("/tmp/somewhere"))


class CrewCallSiteTests(unittest.TestCase):
    """The three call sites actually use the helper (a helper nobody calls fixes nothing)."""

    def _source(self, relative):
        return Path(REPO, relative).read_text()

    def test_pr_scan_routes_its_git_diff_through_git_safe(self):
        src = self._source("dev/pr_scan.py")
        self.assertIn("git_safe.run_git", src)
        self.assertNotIn('subprocess.run(["git"', src)

    def test_publish_routes_every_git_call_through_git_safe(self):
        src = self._source("dev/publish.py")
        self.assertIn("git_safe.run_git", src)
        self.assertIn("git_safe.popen_git", src)
        self.assertNotIn('subprocess.Popen(["git"', src)

    def test_crew_proofs_routes_its_git_lines_through_git_safe(self):
        src = self._source("scripts/crew_proofs.py")
        self.assertIn("git_safe.run_git", src)
        self.assertNotIn('subprocess.run(["git"]', src)


if __name__ == "__main__":
    unittest.main()
