"""Exercise cleanup on disposable directories; never touch real user caches."""

import contextlib
import importlib.util
import io
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("disk_clean", Path(__file__).parents[1] / "disk-clean.py")
disk_clean = importlib.util.module_from_spec(spec)
spec.loader.exec_module(disk_clean)


class DiskCleanTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name).resolve()
        contexts = contextlib.ExitStack()
        self.addCleanup(contexts.close)
        contexts.enter_context(patch.object(Path, "home", return_value=self.home))
        contexts.enter_context(patch.dict(os.environ, {}, clear=True))
        contexts.enter_context(contextlib.redirect_stdout(io.StringIO()))

    def directory(self, name):
        path = self.home / name
        path.mkdir(parents=True, exist_ok=True)
        (path / "keep-or-remove.txt").write_text("fixture")
        return path

    def cleaner(self, *args):
        return disk_clean.Cleaner(disk_clean.parse_args(list(args)))

    def test_preview_does_not_remove_files_or_execute_commands(self):
        target = self.directory(".gradle/caches")
        cleaner = self.cleaner("--dry-run")
        with patch.object(subprocess, "run") as run:
            cleaner.gradle()
            cleaner.run(["sudo", "nix-store", "--gc"])
        run.assert_not_called()
        self.assertTrue(target.exists())

    def test_gradle_and_npm_preserve_configuration_and_projects(self):
        caches = [self.directory(name) for name in (
            ".gradle/caches", ".npm/_cacache", ".npm/_npx", ".npm/_prebuilds"
        )]
        preserved = [self.directory(name) for name in (
            ".gradle/wrapper/dists", "project/node_modules", ".npm/global", "go/pkg/mod"
        )]
        config = self.home / ".gradle/gradle.properties"
        config.write_text("org.gradle.parallel=true")
        with patch.object(disk_clean.shutil, "which", return_value=None), patch.object(
            subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "", "")
        ):
            cleaner = self.cleaner()
            cleaner.gradle()
            cleaner.npm()
        self.assertFalse(any(path.exists() for path in caches))
        self.assertTrue(all(path.exists() for path in preserved))
        self.assertTrue(config.exists())

    def test_symlink_targets_and_parent_symlinks_are_preserved(self):
        outside = self.directory("project")
        link = self.home / "caches"
        link.symlink_to(outside, target_is_directory=True)
        cleaner = self.cleaner()
        cleaner.remove(link, self.home)
        nested = outside / "nested"
        nested.mkdir()
        cleaner.remove(link / "nested", link)
        self.assertTrue((outside / "keep-or-remove.txt").exists())
        self.assertTrue(nested.exists())
        self.assertEqual(len(cleaner.skipped), 2)

    def test_process_check_fails_closed(self):
        cleaner = self.cleaner()
        for category in ("go", "gradle", "npm"):
            with patch.object(subprocess, "run", return_value=subprocess.CompletedProcess([], 1, "", "denied")):
                self.assertFalse(cleaner.idle(category))

    def test_running_tools_are_skipped(self):
        cleaner = self.cleaner()
        for category, line in (
            ("go", "123 /nix/store/go/bin/go go build ./..."),
            ("gradle", "124 /nix/store/jdk/bin/java java org.gradle.launcher.daemon.bootstrap.GradleDaemon"),
            ("npm", "125 /usr/bin/node node /home/user/.npm/_npx/abc/node_modules/tool/index.js"),
        ):
            with patch.object(subprocess, "run", return_value=subprocess.CompletedProcess([], 0, line, "")):
                self.assertFalse(cleaner.idle(category))

    def test_go_temp_age_and_exact_names(self):
        root = self.directory("tmp")
        old = self.directory("tmp/go-build123")
        fresh = self.directory("tmp/go-build456")
        unrelated = self.directory("tmp/go-build-project")
        os.utime(old, (time.time() - 90000,) * 2)
        with patch.object(disk_clean.tempfile, "gettempdir", return_value=str(root)), patch.object(
            disk_clean.shutil, "which", return_value=None
        ), patch.object(disk_clean.Cleaner, "idle", return_value=True):
            self.cleaner().go()
        self.assertFalse(old.exists())
        self.assertTrue(fresh.exists())
        self.assertTrue(unrelated.exists())

    def test_nix_keeps_rollback_generations_and_uses_gc(self):
        root = self.home / ".local/state/nix/profiles"
        root.mkdir(parents=True)
        target = self.directory("store/current")
        for name in ("home-manager", "profile", "channels"):
            (root / name).symlink_to(target, target_is_directory=True)
        cleaner = self.cleaner("--keep", "2")
        with patch.object(disk_clean.shutil, "which", side_effect=lambda name: f"/bin/{name}"), patch.object(
            cleaner, "run"
        ) as run:
            cleaner.nix()
        commands = [[str(arg) for arg in call.args[0]] for call in run.call_args_list]
        self.assertIn(["/bin/nix-env", "--profile", str(root / "home-manager"), "--delete-generations", "+2"], commands)
        self.assertIn(["/bin/nix-env", "--profile", str(root / "profile"), "--delete-generations", "+3"], commands)
        self.assertIn(["/bin/nix-store", "--gc"], commands)
        self.assertTrue(all((root / name).resolve() == target for name in ("home-manager", "profile", "channels")))

    def test_invalid_retention_and_age_rejected(self):
        for args in (("--keep", "0"), ("--tmp-min-age-hours", "-1"), ("--tmp-min-age-hours", "nan")):
            with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                disk_clean.parse_args(args)


if __name__ == "__main__":
    unittest.main()
