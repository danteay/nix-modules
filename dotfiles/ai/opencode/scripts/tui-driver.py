"""Run the smoke-test TUI in a disposable PTY; never attach to the user's terminal."""

import errno
import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios

pid, fd = pty.fork()
if pid == 0:
    os.execvp(sys.argv[1], sys.argv[1:])

fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))


def stop(*_):
    raise SystemExit


signal.signal(signal.SIGTERM, stop)
try:
    while True:
        ready, _, _ = select.select([fd, sys.stdin], [], [], 1)
        if sys.stdin in ready:
            data = os.read(sys.stdin.fileno(), 4096)
            if not data:
                break
            os.write(fd, data)
        if fd not in ready:
            continue
        try:
            data = os.read(fd, 65536)
        except OSError as error:
            if error.errno == errno.EIO:
                break
            raise
        if not data:
            break
        os.write(sys.stdout.fileno(), data)
        if b"\x1b[6n" in data:
            os.write(fd, b"\x1b[1;1R")
        if b"\x1b[c" in data:
            os.write(fd, b"\x1b[?1;2c")
finally:
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    os.close(fd)
    os.waitpid(pid, 0)
