"""Offline deployment boundary and rollback regression tests (Python stdlib)."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import urllib.request


spec = importlib.util.spec_from_file_location('updater', Path(__file__).resolve().parents[1] / 'deploy/pull-update.py')
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)
SHA = 'a' * 40
REPO = 'example/project'
CONFIG = {'repository': REPO, 'branch': 'main', 'workflow': 'ci.yml'}


class PullUpdateTests(unittest.TestCase):
    def make_runtime(self, root, extra=None, commit=SHA):
        archive = root / 'runtime.tar.gz'
        with tarfile.open(archive, 'w:gz') as bundle:
            data = json.dumps(dict(commit=commit, repository=REPO, platform='linux-x64', nodeMajor=24)).encode()
            metadata = tarfile.TarInfo('release.json'); metadata.size = len(data)
            bundle.addfile(metadata, io.BytesIO(data))
            if extra:
                bundle.addfile(extra)
        return archive

    def test_runtime_commit_and_safe_paths(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            stage = root / 'stage'; stage.mkdir()
            updater.unpack_runtime(self.make_runtime(root), stage, SHA, REPO)
            with self.assertRaises(ValueError):
                updater.unpack_runtime(self.make_runtime(root, commit='b' * 40), stage, SHA, REPO)
            for name in ['../escape', '/absolute', 'node_modules/../../escape', 'unapproved']:
                with self.subTest(name=name), self.assertRaises(ValueError):
                    updater.unpack_runtime(self.make_runtime(root, tarfile.TarInfo(name)), stage, SHA, REPO)
            link = tarfile.TarInfo('node_modules/link'); link.type = tarfile.SYMTYPE; link.linkname = '/etc'
            with self.assertRaises(ValueError):
                updater.unpack_runtime(self.make_runtime(root, link), stage, SHA, REPO)

    def test_relative_internal_symlink_is_allowed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); stage = root / 'stage'; stage.mkdir()
            link = tarfile.TarInfo('node_modules/link'); link.type = tarfile.SYMTYPE; link.linkname = 'package'
            updater.unpack_runtime(self.make_runtime(root, link), stage, SHA, REPO)
            self.assertTrue((stage / 'node_modules/link').is_symlink())

    def test_failed_start_restores_links_and_unit(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); app = root / 'app'; app.mkdir()
            for name in ['old', 'older', 'new']:
                (app / name).mkdir()
            (app / 'current').symlink_to(app / 'old')
            (app / 'previous').symlink_to(app / 'older')
            unit = root / 'unit'; unit.write_text('trusted old unit')
            stage = root / 'stage'; stage.mkdir(); (stage / 'release.json').write_text('{}')
            source = root / 'source'; source.write_bytes(b'source')
            calls = []
            def command(*args):
                calls.append(args)
                if args[0] == 'bash':
                    updater.restore_link(app / 'current', app / 'new')
                    updater.restore_link(app / 'previous', app / 'old')
                    unit.write_text('new unit')
                elif args[:2] == ('systemctl', 'restart') and len(calls) == 2:
                    raise RuntimeError('injected startup failure')
            with patch.object(updater, 'APP', app), patch.object(updater, 'UNIT', unit), patch.object(updater, 'command', command), patch.object(updater, 'healthy') as health, patch.object(updater.subprocess, 'run') as run:
                run.return_value.returncode = 0
                with self.assertRaises(RuntimeError):
                    updater.deploy(stage, source)
                health.assert_called_once()
            self.assertEqual((app / 'current').resolve(), (app / 'old').resolve())
            self.assertEqual((app / 'previous').resolve(), (app / 'older').resolve())
            self.assertEqual(unit.read_text(), 'trusted old unit')



if __name__ == '__main__':
    unittest.main()
