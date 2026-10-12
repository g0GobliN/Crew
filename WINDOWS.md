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
| the board's machine label is blank | `os.uname()` is POSIX-only | `platform.node()` |

## If you wire it up by hand

- If `hermes` on `PATH` is a stub, point the plugin at the real binary:
  `set HERMES_BIN=%LOCALAPPDATA%\hermes\bin\hermes.exe`
- If the terminal shows `?` or mojibake instead of the graph, run `chcp 65001` or set `PYTHONUTF8=1`.
- Board DB lives under the Hermes home: `%LOCALAPPDATA%\hermes\kanban.db` on a native install,
  `~/.hermes/kanban.db` under WSL. They are separate installs - do not expect one to see the other's cards.

## Tests

The Windows-specific logic runs on any OS:

```bat
py -3 -m unittest tests.test_crew_windows_support
```
