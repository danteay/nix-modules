#!/usr/bin/env python3
"""Clean reproducible developer caches without removing projects or active profiles."""

import argparse
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time


class Cleaner:
    def __init__(self, args):
        self.args = args
        self.home = Path.home().resolve()
        self.cache = Path(os.environ.get("XDG_CACHE_HOME", self.home / ".cache"))
        self.skipped = []

    def skip(self, message):
        self.skipped.append(message)
        print(f"Skipped: {message}", flush=True)

    def run(self, command):
        command = [str(arg) for arg in command]
        print(f"  $ {shlex.join(command)}", flush=True)
        if not self.args.dry_run:
            subprocess.run(command, check=True)

    def remove(self, path, parent):
        """Only remove an owned directory immediately within a known cache root."""
        path, parent = Path(path), Path(parent)
        if not path.exists() and not path.is_symlink():
            return
        if (
            not path.is_absolute()
            or path.parent != parent
            or path == self.home
            or path.is_symlink()
            or any(p.is_symlink() for p in path.parents)
            or not path.is_dir()
            or path.stat().st_uid != os.getuid()
        ):
            self.skip(f"unsafe cache path: {path}")
            return
        print(f"  {'Would remove' if self.args.dry_run else 'Removing'} {path}", flush=True)
        if not self.args.dry_run:
            shutil.rmtree(path)

    def idle(self, category):
        if self.args.dry_run:
            return True
        result = subprocess.run(
            ["/bin/ps", "-axo", "pid=,comm=,args="], capture_output=True, text=True
        )
        if result.returncode:
            self.skip(f"{category}: cannot inspect running processes; retry from a normal terminal")
            return False
        for line in result.stdout.splitlines():
            fields = line.strip().split(None, 2)
            if len(fields) < 3 or fields[0] == str(os.getpid()):
                continue
            executable, arguments = Path(fields[1]).name, fields[2]
            active = (
                category == "go" and executable in {"go", "compile", "link"}
                or category == "gradle" and re.search(
                    r"GradleDaemon|GradleWrapperMain|GradleMain|GradleWorkerMain", arguments
                )
                or category == "npm" and (
                    executable in {"npm", "npx"}
                    or re.search(r"_npx/|npm-cli\.js|npx-cli\.js|\bnpm (exec|install|ci)\b", arguments)
                )
            )
            if active:
                hint = " Stop Gradle daemons with gradle --stop first." if category == "gradle" else ""
                self.skip(f"{category}: process {fields[0]} is using these tools.{hint}")
                return False
        return True

    def go(self):
        if not self.idle("go"):
            return
        # Keep the command's Go-specific handling of custom GOCACHE locations.
        go = shutil.which("go")
        if go:
            self.run([go, "clean", "-cache"])
        else:
            base = self.home / "Library/Caches" if sys.platform == "darwin" else self.cache
            self.remove(base / "go-build", base)
        # On macOS TMPDIR is the user's private /var/folders/.../T directory.
        # Resolve its system /var symlink once; child symlinks are still rejected.
        roots = {Path(tempfile.gettempdir()).resolve()}
        if os.environ.get("GOTMPDIR"):
            roots.add(Path(os.environ["GOTMPDIR"]).resolve())
        cutoff = time.time() - self.args.tmp_min_age_hours * 3600
        for root in sorted(roots):
            for path in sorted(root.glob("go-build*")):
                if not re.fullmatch(r"go-build\d+", path.name):
                    continue
                if path.is_symlink():
                    self.skip(f"symlinked temporary directory: {path}")
                elif path.is_dir() and path.stat().st_uid == os.getuid():
                    if path.stat().st_mtime > cutoff:
                        print(f"  Keeping recent temporary directory: {path}")
                    else:
                        self.remove(path, root)

    def gradle(self):
        if self.idle("gradle"):
            root = Path(os.environ.get("GRADLE_USER_HOME", self.home / ".gradle"))
            self.remove(root / "caches", root)

    def npm(self):
        if not self.idle("npm"):
            return
        npm = shutil.which("npm")
        if npm:
            # Read the configured cache, but never use npm exec/npx to run cleanup.
            result = subprocess.run([npm, "config", "get", "cache"], check=True,
                                    capture_output=True, text=True)
            root = Path(result.stdout.strip())
        else:
            root = Path(os.environ.get("npm_config_cache", self.home / ".npm"))
        if not root.is_absolute():
            raise ValueError(f"npm cache must be an absolute path: {root}")
        for name in ("_cacache", "_npx", "_prebuilds"):
            self.remove(root / name, root)

    def nix(self):
        nix_env, nix_store = shutil.which("nix-env"), shutil.which("nix-store")
        if not nix_env or not nix_store:
            self.skip("nix: nix-env and nix-store must be on PATH")
            return
        state = Path(os.environ.get("XDG_STATE_HOME", self.home / ".local/state"))
        roots = [state / "nix/profiles", Path("/nix/var/nix/profiles/per-user") / self.home.name]
        profiles = []
        for root in roots:
            for name in ("home-manager", "profile", "channels"):
                if (root / name).is_symlink() and (root / name).exists():
                    profiles.append(root / name)
        # A legacy installation can keep its package profile in ~/.nix-profile.
        legacy = self.home / ".nix-profile"
        if legacy.is_symlink():
            target = Path(os.readlink(legacy))
            if not target.is_absolute():
                target = legacy.parent / target
            if target not in profiles and target.is_symlink() and target.exists():
                profiles.append(target)
        for profile in profiles:
            # Home Manager may create an intermediate package generation, so keep
            # an extra package generation to retain the previous working one.
            keep = self.args.keep + (profile.name == "profile")
            self.run([nix_env, "--profile", profile, "--delete-generations", f"+{keep}"])
        system = Path("/nix/var/nix/profiles/system")
        if system.is_symlink() and system.exists():
            self.run(["sudo", nix_env, "--profile", system, "--delete-generations", f"+{self.args.keep}"])
        self.run([nix_store, "--gc"])
        root = self.cache / "nix"
        for path in sorted(root.glob("*")):
            if re.fullmatch(r"eval-cache-v\d+|tarball-cache-v\d+|gitv\d+", path.name):
                self.remove(path, root)


def parse_args(argv=None):
    parser = argparse.ArgumentParser(prog="disk-clean", description=__doc__, epilog=(
        "Run as your normal user. Nix system pruning requests sudo. Stop builds "
        "and Gradle daemons first. Projects, Go modules, databases, applications, "
        "Gradle distributions/configuration and Nix configuration are preserved."
    ))
    parser.add_argument("--dry-run", action="store_true", help="show targets and commands without deleting anything")
    parser.add_argument("--only", choices=("nix", "go", "gradle", "npm"), action="append",
                        help="clean only this category; may be repeated")
    parser.add_argument("--keep", type=int, default=2, metavar="N", help="retain N Nix generations (default: 2)")
    parser.add_argument("--tmp-min-age-hours", type=float, default=24, metavar="HOURS",
                        help="minimum Go temporary directory age (default: 24; 0 includes recent builds)")
    args = parser.parse_args(argv)
    if args.keep < 1:
        parser.error("--keep must be at least 1")
    if not 0 <= args.tmp_min_age_hours < float("inf"):
        parser.error("--tmp-min-age-hours must be finite and nonnegative")
    return args


def main(argv=None):
    args = parse_args(argv)
    if os.geteuid() == 0:
        print("Run disk-clean as your normal user, not with sudo.", file=sys.stderr)
        return 2
    cleaner = Cleaner(args)
    before = shutil.disk_usage(cleaner.home).free
    for category in args.only or ("go", "gradle", "npm", "nix"):
        print(f"\n{category.upper()}{' (preview)' if args.dry_run else ''}", flush=True)
        try:
            getattr(cleaner, category)()
        except (OSError, ValueError, subprocess.CalledProcessError) as error:
            cleaner.skip(f"{category}: {error}")
    after = shutil.disk_usage(cleaner.home).free
    print(f"\nAvailable space: {after / 2**30:.1f} GiB")
    if not args.dry_run:
        print(f"Free-space change: {(after - before) / 2**30:+.1f} GiB (includes concurrent disk activity)")
    return 1 if cleaner.skipped else 0


if __name__ == "__main__":
    sys.exit(main())
