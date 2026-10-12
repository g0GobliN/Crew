# Security Policy

## Reporting a vulnerability

Report privately through [GitHub security advisories](https://github.com/macd2/Crew/security/advisories/new).
Do not open a public issue or pull request for a vulnerability.

Include: what is affected (file and function), the Crew version (`plugin.yaml`) and Hermes version,
your OS, and steps to reproduce.

We respond within 2 days. After a fix is released we will credit you in the release notes
unless you prefer not to be named.

## Scope

In scope: Crew's own code.

- **Proof execution:** a card's proof command running outside the limits Crew sets for it.
- **The board server:** the web dashboard exposing data or actions to something it should not.
- **The installer:** `install.py` and `install.sh` writing or running something unintended.

Out of scope: vulnerabilities in Hermes Agent itself (report those to
[Hermes Agent](https://github.com/NousResearch/hermes-agent/security)), in a model provider, or in
tools a user configured Crew to run. A proof command is code the card's owner chose to run; that it runs is not a bug.
