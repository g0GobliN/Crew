#!/bin/sh
# Runs one of crew's scripts with a Python 3 that exists on this machine. Agents are told to call
#     sh "$HERMES_HOME/plugins/crew/scripts/crew-run.sh" crew_card.py verdict --card <id>
# because the commands an agent types run in bash on every platform (Git Bash on native Windows) but `python3` is
# not a command everywhere: a native Windows Hermes (install.ps1) puts only its own venv python on disk, and the
# Windows Store `python.exe` stub is not an interpreter. Order: $CREW_PYTHON, then Hermes's own venv python (the one
# the scripts re-run under anyway), then python3 / python / py -3 from PATH, each proven by running it.
# `pwd -W` (Git Bash) gives C:/... : a native Windows python cannot open the /c/... form, and Hermes turns MSYS argument
# conversion off for the commands it runs, so nothing would translate it on the way.
case $0 in */*) here=$(cd "${0%/*}" && { pwd -W 2>/dev/null || pwd; }) ;; *) here=$({ pwd -W 2>/dev/null || pwd; }) ;; esac
script=$1
if [ -z "$script" ]; then echo "usage: crew-run.sh <crew script.py> [args...]" >&2; exit 2; fi
shift
case $script in /*|?:*) ;; *) script=$here/$script ;; esac

works() { "$@" -c "import sys; sys.exit(0 if sys.version_info[0] == 3 else 1)" >/dev/null 2>&1; }

home=${HERMES_HOME:-}
while :; do case $home in *\\*) home=${home%%\\*}/${home#*\\} ;; *) break ;; esac; done
root=${home%/profiles/*}
for py in "${CREW_PYTHON:-}" \
          "$root/hermes-agent/venv/Scripts/python.exe" "$root/hermes-agent/venv/bin/python" \
          "$home/hermes-agent/venv/Scripts/python.exe" "$home/hermes-agent/venv/bin/python"; do
  if [ -n "$py" ] && [ -f "$py" ] && works "$py"; then exec "$py" "$script" "$@"; fi
done
for py in python3 python; do
  if command -v "$py" >/dev/null 2>&1 && works "$py"; then exec "$py" "$script" "$@"; fi
done
if command -v py >/dev/null 2>&1 && works py -3; then exec py -3 "$script" "$@"; fi
echo "crew-run.sh: no Python 3 found (tried CREW_PYTHON, Hermes's venv, python3, python, py -3)" >&2
exit 127
