#!/usr/bin/env python3
"""Process facts the crew needs on every OS: is a pid running, what is its command line, end its tree.

One module, because `os.kill(pid, 0)` is a liveness probe only on POSIX: on Windows signal 0 is not a signal and
raises WinError 87 for any pid. Windows uses OpenProcess + GetExitCodeProcess (stdlib ctypes only); POSIX keeps
signal 0, and a zombie (a killed child nobody reaped) counts as gone on Linux.
"""
import os
import signal
import subprocess
import time

IS_WINDOWS = os.name == "nt"
STILL_ACTIVE = 259                       # GetExitCodeProcess for a process that has not exited
_QUERY_LIMITED = 0x1000                  # PROCESS_QUERY_LIMITED_INFORMATION
_SYNCHRONIZE = 0x00100000


def _win_alive(pid):
    import ctypes
    from ctypes import wintypes
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.OpenProcess.restype = wintypes.HANDLE
    k32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    k32.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
    k32.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = k32.OpenProcess(_QUERY_LIMITED, False, pid)
    if not handle:
        # ERROR_ACCESS_DENIED (5): it exists but is not ours to query. Anything else (87 bad pid, ...): gone.
        return ctypes.get_last_error() == 5
    try:
        code = wintypes.DWORD()
        if not k32.GetExitCodeProcess(handle, ctypes.byref(code)):
            return False
        return code.value == STILL_ACTIVE
    finally:
        k32.CloseHandle(handle)


def alive(pid):
    """True while `pid` is a running process. A zombie reads dead. Garbage (None, text, <= 0) reads dead."""
    try:
        pid = int(pid)
    except (TypeError, ValueError):
        return False
    if pid <= 0:
        return False
    if IS_WINDOWS:
        return _win_alive(pid)
    try:
        with open("/proc/%d/stat" % pid, encoding="utf-8") as fh:
            if fh.read().rsplit(") ", 1)[-1][:1] == "Z":
                return False
    except OSError:
        pass
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except (PermissionError, ValueError, OverflowError):
        return True


def cmdline_of(pid):
    """The process's command line as one string, '' when unreadable."""
    try:
        pid = int(pid)
    except (TypeError, ValueError):
        return ""
    if IS_WINDOWS:
        ps = ("(Get-CimInstance Win32_Process -Filter 'ProcessId=%d').CommandLine" % pid)
        try:
            done = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command",
                                   "[Console]::OutputEncoding=[Text.Encoding]::UTF8; " + ps],
                                  capture_output=True, encoding="utf-8", errors="replace", timeout=30)
        except (OSError, subprocess.SubprocessError):
            return ""
        return (done.stdout or "").strip()
    try:
        with open("/proc/%d/cmdline" % pid, encoding="utf-8") as fh:
            return fh.read().replace("\0", " ")
    except OSError:
        return ""


def terminate_tree(pid, wait_s=1.0):
    """End `pid` and everything it started. POSIX: SIGTERM then SIGKILL to the process group, then the pid itself.
    Windows: `taskkill /T /F` (the tree, forced). Returns True when the pid is gone afterwards."""
    pid = int(pid)
    if IS_WINDOWS:
        try:
            subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, timeout=60)
        except (OSError, subprocess.SubprocessError):
            pass
        deadline = time.time() + max(wait_s, 5.0)
        while alive(pid) and time.time() < deadline:
            time.sleep(0.1)
        return not alive(pid)
    try:
        pgid = os.getpgid(pid)
    except ProcessLookupError:
        return not alive(pid)
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(pgid, sig)
        except ProcessLookupError:
            break
        time.sleep(wait_s)
        if not alive(pid):
            break
    if alive(pid):
        try:
            os.kill(pid, signal.SIGKILL)
        except OSError:
            pass
    return not alive(pid)


def utf8_stdio():
    """Print UTF-8 whatever the console code page is (a piped Windows child defaults to cp1252, which turns the
    '·' and the status emoji the crew prints into errors or mojibake for whoever reads the pipe)."""
    import sys
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError, OSError):
            pass
