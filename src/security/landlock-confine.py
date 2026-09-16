#!/usr/bin/env python3
"""Apply a Landlock ruleset, then exec the given command.

Stdlib only. Used by src/security/native-sandbox.ts when Bubblewrap cannot
create a user namespace. Fail-closed: any setup error exits non-zero without
executing the command.
"""
from __future__ import annotations

import ctypes
import os
import sys

SYS_LANDLOCK_CREATE_RULESET = 444
SYS_LANDLOCK_ADD_RULE = 445
SYS_LANDLOCK_RESTRICT_SELF = 446
LANDLOCK_CREATE_RULESET_VERSION = 1 << 0
LANDLOCK_RULE_PATH_BENEATH = 1
PR_SET_NO_NEW_PRIVS = 38

FS_EXECUTE = 1 << 0
FS_WRITE_FILE = 1 << 1
FS_READ_FILE = 1 << 2
FS_READ_DIR = 1 << 3
FS_REMOVE_DIR = 1 << 4
FS_REMOVE_FILE = 1 << 5
FS_MAKE_CHAR = 1 << 6
FS_MAKE_DIR = 1 << 7
FS_MAKE_REG = 1 << 8
FS_MAKE_SOCK = 1 << 9
FS_MAKE_FIFO = 1 << 10
FS_MAKE_BLOCK = 1 << 11
FS_MAKE_SYM = 1 << 12
FS_REFER = 1 << 13
FS_TRUNCATE = 1 << 14
FS_IOCTL_DEV = 1 << 15
NET_BIND_TCP = 1 << 0
NET_CONNECT_TCP = 1 << 1


class RulesetAttr(ctypes.Structure):
    _fields_ = [
        ("handled_access_fs", ctypes.c_uint64),
        ("handled_access_net", ctypes.c_uint64),
    ]


class PathBeneath(ctypes.Structure):
    _pack_ = 1
    _fields_ = [
        ("allowed_access", ctypes.c_uint64),
        ("parent_fd", ctypes.c_int32),
    ]


def _die(message: str, code: int = 1) -> None:
    sys.stderr.write(f"native-sandbox landlock: {message}\n")
    raise SystemExit(code)


def _parse(argv: list[str]) -> tuple[list[str], list[str], list[str], str | None, bool, list[str]]:
    projects: list[str] = []
    tmps: list[str] = []
    ros: list[str] = []
    chdir: str | None = None
    network = False
    i = 0
    while i < len(argv):
        token = argv[i]
        if token == "--":
            return projects, tmps, ros, chdir, network, argv[i + 1 :]
        if token == "--network":
            network = True
            i += 1
            continue
        if i + 1 >= len(argv):
            _die(f"missing value for {token}")
        value = argv[i + 1]
        if token == "--project":
            projects.append(value)
        elif token == "--tmp":
            tmps.append(value)
        elif token == "--ro":
            ros.append(value)
        elif token == "--chdir":
            chdir = value
        else:
            _die(f"unknown argument {token}")
        i += 2
    _die("missing -- and command")
    raise AssertionError("unreachable")


def _syscall(libc: ctypes.CDLL, number: int, *args: object) -> int:
    libc.syscall.restype = ctypes.c_long
    return int(libc.syscall(ctypes.c_long(number), *args))


def _fs_handled(abi: int) -> int:
    bits = (
        FS_EXECUTE
        | FS_WRITE_FILE
        | FS_READ_FILE
        | FS_READ_DIR
        | FS_REMOVE_DIR
        | FS_REMOVE_FILE
        | FS_MAKE_CHAR
        | FS_MAKE_DIR
        | FS_MAKE_REG
        | FS_MAKE_SOCK
        | FS_MAKE_FIFO
        | FS_MAKE_BLOCK
        | FS_MAKE_SYM
    )
    if abi >= 2:
        bits |= FS_REFER
    if abi >= 3:
        bits |= FS_TRUNCATE
    if abi >= 4:
        bits |= FS_IOCTL_DEV
    return bits


def _access_ro(abi: int) -> int:
    bits = FS_EXECUTE | FS_READ_FILE | FS_READ_DIR
    if abi >= 3:
        bits |= FS_TRUNCATE
    if abi >= 4:
        bits |= FS_IOCTL_DEV
    return bits


def _access_rw(abi: int) -> int:
    bits = _access_ro(abi) | (
        FS_WRITE_FILE
        | FS_REMOVE_DIR
        | FS_REMOVE_FILE
        | FS_MAKE_CHAR
        | FS_MAKE_DIR
        | FS_MAKE_REG
        | FS_MAKE_SOCK
        | FS_MAKE_FIFO
        | FS_MAKE_BLOCK
        | FS_MAKE_SYM
    )
    if abi >= 2:
        bits |= FS_REFER
    return bits


def _access_dev(abi: int) -> int:
    # /dev/null must be writable; creating new device nodes must not.
    bits = FS_EXECUTE | FS_READ_FILE | FS_READ_DIR | FS_WRITE_FILE
    if abi >= 3:
        bits |= FS_TRUNCATE
    if abi >= 4:
        bits |= FS_IOCTL_DEV
    return bits


def _add_path(libc: ctypes.CDLL, ruleset_fd: int, path: str, access: int) -> None:
    if not os.path.exists(path):
        return
    parent_fd = os.open(path, os.O_PATH | os.O_CLOEXEC)
    try:
        rule = PathBeneath(access, parent_fd)
        added = _syscall(libc, SYS_LANDLOCK_ADD_RULE, ruleset_fd, LANDLOCK_RULE_PATH_BENEATH, ctypes.byref(rule), 0)
        if added < 0:
            _die(f"landlock_add_rule({path}) failed errno={ctypes.get_errno()}")
    finally:
        os.close(parent_fd)


def main(argv: list[str]) -> None:
    if os.name != "posix":
        _die("Landlock is a Linux kernel ABI")
    projects, tmps, ros, chdir, network, command = _parse(argv)
    if not command:
        _die("empty command")
    if not projects:
        _die("missing --project")

    libc = ctypes.CDLL("libc.so.6", use_errno=True)
    abi = _syscall(libc, SYS_LANDLOCK_CREATE_RULESET, None, 0, LANDLOCK_CREATE_RULESET_VERSION)
    if abi < 1:
        _die(f"landlock_create_ruleset(VERSION) failed abi={abi} errno={ctypes.get_errno()}")

    handled_fs = _fs_handled(abi)
    handled_net = 0 if network or abi < 5 else (NET_BIND_TCP | NET_CONNECT_TCP)
    attr = RulesetAttr(handled_fs, handled_net)
    attr_size = 8 if abi < 5 else 16
    ruleset_fd = _syscall(libc, SYS_LANDLOCK_CREATE_RULESET, ctypes.byref(attr), attr_size, 0)
    if ruleset_fd < 0:
        _die(f"landlock_create_ruleset failed errno={ctypes.get_errno()}")

    try:
        ro_access = _access_ro(abi)
        rw_access = _access_rw(abi)
        for path in ros:
            access = _access_dev(abi) if os.path.abspath(path) == "/dev" else ro_access
            _add_path(libc, ruleset_fd, path, access)
        for path in projects + tmps:
            _add_path(libc, ruleset_fd, path, rw_access)

        nnp = libc.prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)
        if nnp < 0:
            _die(f"prctl(NO_NEW_PRIVS) failed errno={ctypes.get_errno()}")
        restricted = _syscall(libc, SYS_LANDLOCK_RESTRICT_SELF, ruleset_fd, 0)
        if restricted < 0:
            _die(f"landlock_restrict_self failed errno={ctypes.get_errno()}")
    finally:
        os.close(ruleset_fd)

    if chdir:
        os.chdir(chdir)

    executable = command[0]
    if not os.path.isabs(executable) and os.sep not in executable:
        found = None
        for directory in os.environ.get("PATH", "").split(os.pathsep):
            candidate = os.path.join(directory, executable)
            if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
                found = candidate
                break
        if found is None:
            _die(f"command not found on PATH: {executable}", 127)
        executable = found
        command = [executable, *command[1:]]

    os.execvpe(executable, command, os.environ)
    _die(f"exec failed: {executable}", 127)


if __name__ == "__main__":
    main(sys.argv[1:])
