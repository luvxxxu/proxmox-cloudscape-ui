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
import zipfile

spec = importlib.util.spec_from_file_location('updater', Path(__file__).resolve().parents[1] / 'deploy/pull-update.py')
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)
SHA = 'a' * 40
REPO = 'example/project'
CONFIG = {'repository': REPO, 'branch': 'main', 'workflow': 'ci.yml'}


class PullUpdateTests(unittest.TestCase):
    def test_only_successful_push_from_exact_repo_commit_branch_workflow(self):
        run = {'head_sha': SHA, 'head_branch': 'main', 'event': 'push', 'status': 'completed', 'conclusion': 'success', 'head_repository': {'full_name': REPO}, 'path': '.github/workflows/ci.yml'}
        self.assertEqual(updater.select_run([run], SHA, CONFIG), run)
        for key, value in [('head_sha', 'b' * 40), ('head_branch', 'other'), ('event', 'pull_request'), ('status', 'in_progress'), ('conclusion', 'failure'), ('head_repository', {'full_name': 'attacker/fork'}), ('path', '.github/workflows/other.yml')]:
            with self.subTest(key=key):
                self.assertIsNone(updater.select_run([{**run, key: value}], SHA, CONFIG))

    def test_redirect_does_not_send_token_to_artifact_host(self):
        request = urllib.request.Request('https://api.github.com/x', headers={'Authorization': 'Bearer secret'})
        redirect = updater.HTTPSRedirect().redirect_request(request, None, 302, '', {}, 'https://storage.example/file')
        self.assertIsNone(redirect.get_header('Authorization'))
        with self.assertRaises(ValueError):
            updater.HTTPSRedirect().redirect_request(request, None, 302, '', {}, 'http://storage.example/file')

    def test_zip_digest_and_exact_contents(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / 'artifact.zip'
            with zipfile.ZipFile(archive, 'w') as bundle:
                bundle.writestr('runtime.tar.gz', b'runtime')
            digest = 'sha256:' + hashlib.sha256(archive.read_bytes()).hexdigest()
            updater.unpack_artifact(archive, root / 'runtime', digest)
            self.assertEqual((root / 'runtime').read_bytes(), b'runtime')
            for invalid in [None, 'sha256:' + '0' * 64]:
                with self.assertRaises(ValueError):
                    updater.unpack_artifact(archive, root / 'bad', invalid)
            with zipfile.ZipFile(archive, 'a') as bundle:
                bundle.writestr('../outside', b'no')
            digest = 'sha256:' + hashlib.sha256(archive.read_bytes()).hexdigest()
            with self.assertRaises(ValueError):
                updater.unpack_artifact(archive, root / 'bad', digest)

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

    def test_pull_downloads_exact_commit_and_skips_changed_branch(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            runtime = self.make_runtime(root).read_bytes()
            zipped = io.BytesIO()
            with zipfile.ZipFile(zipped, 'w') as bundle:
                bundle.writestr('runtime.tar.gz', runtime)
            payload = zipped.getvalue()
            run = dict(id=12, head_sha=SHA, head_branch='main', event='push', status='completed', conclusion='success', head_repository={'full_name': REPO}, path='.github/workflows/ci.yml')
            requests = []
            def request(path, output=None):
                requests.append(path)
                if output:
                    output.write_bytes(payload if path.endswith('/zip') else b'repository source')
                elif '/workflows/' in path:
                    return {'workflow_runs': [run]}
                else:
                    return {'artifacts': [dict(id=34, name='runtime-linux-x64-' + SHA, expired=False, digest='sha256:' + hashlib.sha256(payload).hexdigest())]}
            for final_head in [SHA, 'b' * 40]:
                with self.subTest(head=final_head), patch.object(updater, 'APP', root), patch.object(updater, 'GitHub') as github, patch.object(updater, 'deploy') as deploy:
                    github.return_value.head.side_effect = [SHA, final_head]
                    github.return_value.request.side_effect = request
                    updater.update(CONFIG)
                    self.assertEqual(deploy.call_count, int(final_head == SHA))
            self.assertIn('/tarball/' + SHA, requests)
            self.assertIn('/actions/artifacts/34/zip', requests)

    def test_no_successful_ci_does_not_deploy_or_download(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(updater, 'APP', Path(temporary)), patch.object(updater, 'GitHub') as github, patch.object(updater, 'deploy') as deploy:
            github.return_value.head.return_value = SHA
            github.return_value.request.return_value = {'workflow_runs': []}
            updater.update(CONFIG)
            self.assertEqual(github.return_value.request.call_count, 1)
            deploy.assert_not_called()


if __name__ == '__main__':
    unittest.main()
