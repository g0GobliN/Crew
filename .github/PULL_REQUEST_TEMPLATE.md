## What and why

<!-- What does this change, and what problem does it solve? -->

## Related issue

<!-- Fixes #123, if there is one. Bigger features go smoother with an issue first. -->

## Type of change

- [ ] Bug fix
- [ ] Cross-platform (Windows / WSL / macOS)
- [ ] Security hardening (not an undisclosed vulnerability: those go to private reporting, see SECURITY.md)
- [ ] Robustness / board
- [ ] New feature
- [ ] Docs or tests only

## How to test

1.
2.

## Platform tested on

<!-- e.g. Windows 11 native, Ubuntu 24.04 in WSL, macOS 15 -->

## Checklist

- [ ] One logical change, no unrelated commits
- [ ] Commits follow Conventional Commits (`fix(scope):`, `feat(scope):`)
- [ ] `python -m pytest tests -q` passes
- [ ] I added tests, or said above why not
- [ ] Works on Windows, macOS and Linux, or I said above what I could not check
- [ ] No machine-specific strings (home paths, hostnames, emails) in the diff
