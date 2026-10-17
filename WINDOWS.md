# Hermes.Crew on Windows

Crew is written for a POSIX host, and two of its install steps have no native Windows equivalent: the
graph-http **systemd user unit** and the nightly-proofs **cron** job. Everything else installs the same.
There are two ways to run it from Windows; pick one and stay on it, because a native install and a WSL
install are separate Hermes homes with separate kanban boards and separate sessions.

## Route A - WSL / Ubuntu (no extra work)

WSL is a POSIX host, so the [README](README.md) install works exactly as written, including the systemd
service and `--nightly-proofs`. Use `python3` and `~/.hermes` paths as documented. This is the route to
take if you want the nightly proofs and the self-starting dashboard with no manual steps.

WSL2 starts with systemd switched off, and `systemctl --user` fails until it is on. Turn it on once:

```sh
# inside WSL
printf '\n[boot]\nsystemd=true\n' | sudo tee -a /etc/wsl.conf
# then in Windows PowerShell
wsl --shutdown
# back in the distro, this should print systemd
ps -p 1 -o comm=
```

## Route B - Native Windows ("This device" Hermes Desktop)

### 1. Install, skipping the two POSIX-only steps

The plugin is installed into the profile's own plugin folder. Point `CREW` at it first:

```bat
rem a named profile
set CREW=%LOCALAPPDATA%\hermes\profiles\NAME\plugins\crew
rem or the default profile
set CREW=%LOCALAPPDATA%\hermes\plugins\crew

py -3 %CREW%\install.py --profile NAME --no-cron
py -3 %CREW%\install.py --check --profile NAME
hermes -p NAME plugins doctor crew
```

On native Windows the installer skips the systemd unit by itself, and `--no-cron` skips the cron job. Role profiles, skills,
hooks and the command menus are written exactly as on Linux. `NAME` is the profile you chat with
(`default` if you do not use profiles). Use `python` or `py -3` wherever the docs say `python3`.

Crew runs every proof in the Git Bash Hermes itself uses, so no WSL is needed. It looks, in order, for
`HERMES_GIT_BASH_PATH`, the PortableGit Hermes's own installer puts under `%LOCALAPPDATA%\hermes\git`, then
`bin\bash.exe` or `usr\bin\bash.exe` next to the `git.exe` on your `PATH` ([Git for Windows](https://git-scm.com/download/win)).
It never uses `C:\Windows\System32\bash.exe`, which is WSL's and a different machine. Without any of them the proof
does not run and reports `Git Bash was not found next to git.exe: crew proofs run in Git Bash on Windows (install Git
for Windows); the proof was not run`. Checking whether a worker process is alive, and stopping or parking a card, work
natively too (`OpenProcess` and `taskkill /T /F`).

If you use Hermes Desktop, crew's Crew page needs no dashboard server; see
[Crew in Hermes Desktop](README.md#crew-in-hermes-desktop) for which profile to install into.

### 2. Run the dashboard without systemd

The server binds `127.0.0.1:8799` (override with `CREW_GRAPH_PORT` / `CREW_GRAPH_BIND`):

```bat
py -3 %CREW%\scripts\crew_graph_serve.py
```

Open `http://127.0.0.1:8799/`. To keep it up across reboots, register a logon task (no admin needed):

```bat
schtasks /Create /TN CrewGraphHttp /SC ONLOGON /RL LIMITED ^
  /TR "py -3 %CREW%\scripts\crew_graph_serve.py"
```

An `HKCU\...\CurrentVersion\Run` entry works too.

### 3. Nightly proofs without cron

Native Windows has no user cron. Either leave `--nightly-proofs` off and run proofs on demand
(`/crew-graph`, `/crew-proof`), or make a Task Scheduler job that runs
`<profile>\scripts\crew_proofs_nightly.py` with the Hermes interpreter on a daily trigger.

### 4. Cards move only under the gateway, not `serve`

Kanban dispatch runs in **`hermes gateway`**, which holds a single lock at
`<hermes home>\kanban\.dispatcher.lock`. The Desktop backend can spawn `hermes ... serve`, which answers
chat but does **not** run the dispatcher - cards sit in `ready` forever. To have open cards actually run,
drive them from a gateway process pointed at the same kanban home your Desktop uses.

## What the Windows fixes changed (current `main`)

The runtime failures on a host with no POSIX shell around the plugin are fixed in the shipped code:

| Symptom | Cause | Fix |
|---|---|---|
| `/crew` in the Desktop only says "runs in the terminal..." | a plugin **command** named `crew` shadowed the intake **skill** (dispatch handles commands before skills) | the command was removed; `/crew` is the skill again |
| `/crew-graph` → `UnicodeEncodeError ... can't encode` | the Windows console defaults to the locale codepage (e.g. `cp1253`), which cannot print box-drawing | graph children run with `PYTHONIOENCODING=utf-8` and `PYTHONUTF8=1`, plus `errors="replace"` |
| `/crew-graph` → `unsupported operand type(s) for +: 'NoneType' and 'str'` | a child died before printing, leaving `stdout`/`stderr` `None` | None-safe stream concat |
| coordinator / owner-comment child dies: `Could not determine home directory.` | native processes have `USERPROFILE` but no `HOME`, and CPython's `Path.home()` raises | `proof_env` cross-fills `HOME`/`USERPROFILE`, **Windows only** |
| the plugin reads its config back as `None` | `PATH` can lead with a 0-byte `hermes` stub ahead of `bin\hermes.exe` | `_which_hermes()` skips PATH hits this OS cannot run |
| a proof reports `Git Bash was not found next to git.exe` | on Windows a proof runs in Git Bash, and `git.exe` is missing from `PATH` or has no `bash.exe` beside it | install Git for Windows and reopen the terminal; crew never falls back to WSL's `bash.exe` or `cmd.exe` |
| the install reports a consent-record or hook file-mode finding on Windows | Windows cannot express POSIX file modes (`0600`, the exec bit) | those two checks now run only on POSIX hosts; a Windows profile is protected by its ACLs |
| the board's machine label is blank | `os.uname()` is POSIX-only | `platform.node()` |
| `crew_card.py` or a proof's safety guard cannot find Hermes: `hermes_python()` is empty, `tools.approval_detection` does not import | crew looked for `venv/bin/python` and `lib/python*/site-packages`; a Windows venv has `venv\Scripts\python.exe` and `Lib\site-packages`, and Hermes's source sits at `%LOCALAPPDATA%\hermes\hermes-agent`, not `~/.hermes/hermes-agent` (reported in #8 by @tianola) | one venv lookup (`crew_card.venv_python`, `venv_site_packages`) and one default home (`crew_card.default_home`) used everywhere |
| a script re-run under the Hermes python returns at once with status 0 | Windows has no `exec`: `os.execv` starts the new process and ends the old one | the re-run waits for the child and passes its exit status on (the nightly-proofs shim too) |
| a proof or a worker instruction says `python3`, which Windows does not have | the commands crew writes named `python3` | on Windows they name the interpreter that runs crew, quoted, with forward slashes |
| an agent's `python3 "$HERMES_HOME/plugins/crew/scripts/..."` fails: `python3: command not found` (a CI box with `setup-python` hid it) | the skills told agents to run `python3`; a native Windows Hermes provides only its own venv python | the skills give `sh "$HERMES_HOME/plugins/crew/scripts/crew-run.sh" crew_card.py ...`; the launcher picks `$CREW_PYTHON`, Hermes's venv python, then `python3`, `python`, `py -3` (the e2e job runs those exact commands through Hermes's terminal with no python on PATH) |
| crew defaults to `~/.hermes` when `HERMES_HOME` is unset | the Windows default home is `%LOCALAPPDATA%\hermes` | `crew_card.default_home()` |
| `crew_route_pin_proof.py` / `crew_terminal_window_proof.py` die with `UnicodeEncodeError: 'charmap'` under `crew_proofs.py` (#15) | a child's stdout to a pipe is the ANSI code page (cp1252), not the console's | `crew_proofs.child_env` gives every proof `PYTHONIOENCODING=utf-8` unless the caller set one |
| `crew_role_platforms_proof.py` → `FileNotFoundError: [WinError 2]` (#15) | `gateway_identity()` called `systemctl` with no guard once a `gateway_state.json` existed | it returns "no gateway" when `systemctl` is not on `PATH`, like the service check |
| `tests/test_crew_board_archived` → `No module named 'hermes_yaml'` (#15) | `tests/kernel_board.py` looked for Hermes's source only at `~/.hermes/hermes-agent` | it uses `crew_card.hermes_root()` (`HERMES_AGENT_DIR`, else `%LOCALAPPDATA%\hermes\hermes-agent`) |

**What "the proofs pass on Windows" means.** The 0.9.10 release note said crew "runs and passes its proofs on
native Windows 11"; issue #15 measured otherwise. On Windows 11 build 26300 with Hermes Desktop (2026-10-17):
0.9.11 ran 31 proofs, passed 28; 0.9.12 (`crew_proofs.py --all`, graph running) ran 35, passed 35, none held
back, and the unit suite passed 756 of 756. Proofs that need systemd or cron report "does not apply here" on
Windows: a pass there has not checked that part.

## If you wire it up by hand

- If `hermes` on `PATH` is a stub, point the plugin at the real binary:
  `set HERMES_BIN=%LOCALAPPDATA%\hermes\bin\hermes.exe`
- If the terminal shows `?` or mojibake instead of the graph, run `chcp 65001` or set `PYTHONUTF8=1`.
- Board DB lives under the Hermes home: `%LOCALAPPDATA%\hermes\kanban.db` on a native install,
  `~/.hermes/kanban.db` under WSL. They are separate installs - do not expect one to see the other's cards.

## Tests

The Windows-specific logic runs on any OS:

```bat
py -3 -m unittest tests.test_crew_windows_support tests.test_crew_windows_layout
```

The `e2e-windows` job in `.github/workflows/tests.yml` runs the other half on a real native Windows Hermes: it installs
Hermes with its own `install.ps1`, installs crew into a profile with `install.py --profile e2e --no-cron`, and runs
`tests/e2e/windows_native.py`, which checks the Windows venv python, the safety guard, a proof in Git Bash and its exit
code, the re-run under the Hermes python, the board and dashboard, and process liveness and stop.
