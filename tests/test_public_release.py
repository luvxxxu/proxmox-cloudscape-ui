import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import urllib.error
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'deploy'))
import public_release as release
spec = importlib.util.spec_from_file_location('release_updater', Path(release.__file__).with_name('pull-update.py'))
updater = importlib.util.module_from_spec(spec); spec.loader.exec_module(updater)


def manifest(version='v0.2.1'):
    data = dict(schema=1, version=version, repository=release.REPOSITORY, commit='a'*40, platform='linux-x64', nodeMajor=24)
    for kind, name in [('runtime', 'runtime-linux-x64.tar.gz'), ('source', 'source.tar.gz')]:
        data[kind] = dict(name=name, size=7, sha256=hashlib.sha256(b'payload').hexdigest())
    return data


class PublicReleaseTests(unittest.TestCase):
    def test_reject_prerelease_wrong_platform_and_asset_injection(self):
        for key, value in [('version', 'v1.0.0-rc.1'), ('version', '../escape'), ('version', 'v01.0.0'),
                           ('repository', 'other/repo'), ('platform', 'linux-arm64'), ('nodeMajor', 25)]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                release.validate({**manifest(), key: value})
        data = manifest(); data['source']['name'] = '../../escape'
        with self.assertRaises(ValueError): release.validate(data)

    def test_asset_checksum_and_exact_version_without_token(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / 'asset'
            with patch.object(release, 'download') as download:
                download.side_effect = lambda url, out, limit: out.write_bytes(b'payload')
                release.asset(manifest(), 'runtime', output)
                self.assertIn('/releases/download/v0.2.1/runtime-linux-x64.tar.gz', download.call_args.args[0])
                download.side_effect = lambda url, out, limit: out.write_bytes(b'corrupt')
                with self.assertRaises(ValueError): release.asset(manifest(), 'runtime', output)
                self.assertFalse(output.exists())

    def test_anonymous_request_and_404_no_install(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(release.urllib.request, 'build_opener') as build:
            build.return_value.open.side_effect = urllib.error.HTTPError('https://github.com/', 404, 'Not Found', {}, None)
            with self.assertRaisesRegex(RuntimeError, 'No published stable release'):
                release.latest()
            request = build.return_value.open.call_args.args[0]
            self.assertFalse(request.has_header('Authorization'))
            self.assertNotIn('api.github.com', request.full_url)
            self.assertEqual(build.return_value.open.call_count, 1)

    def test_transient_network_retry_bounded(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(release.urllib.request, 'build_opener') as build, patch.object(release.time, 'sleep'):
            build.return_value.open.side_effect = urllib.error.URLError('refused')
            with self.assertRaises(RuntimeError):
                release.download(f'https://github.com/{release.REPOSITORY}/releases/latest/download/release.json', Path(temporary)/'asset', 100)
            self.assertEqual(build.return_value.open.call_count, 3)

    def test_no_downgrade_or_reinstall(self):
        for current in ('v0.2.1', 'v0.3.0'):
            with tempfile.TemporaryDirectory() as temporary, patch.object(updater, 'APP', Path(temporary)), patch.object(release, 'latest', return_value=manifest()), patch.object(release, 'runtime') as runtime:
                directory = Path(temporary) / 'current'; directory.mkdir()
                (directory / 'public-release.json').write_text(json.dumps(manifest(current)))
                updater.update({'repository': release.REPOSITORY, 'channel': 'stable'})
                runtime.assert_not_called()

    def test_changed_release_does_not_activate(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(updater, 'APP', Path(temporary)), patch.object(release, 'latest', side_effect=[manifest(), manifest('v0.2.2')]), patch.object(release, 'runtime'), patch.object(release, 'asset'), patch.object(updater, 'deploy') as deploy:
            updater.update({'repository': release.REPOSITORY, 'channel': 'stable'})
            deploy.assert_not_called()

    def test_failed_activation_does_not_record_release(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(updater, 'APP', Path(temporary)), patch.object(release, 'latest', return_value=manifest()), patch.object(release, 'runtime'), patch.object(release, 'asset'), patch.object(updater, 'deploy', side_effect=RuntimeError('unhealthy')):
            with self.assertRaises(RuntimeError): updater.update({'repository': release.REPOSITORY, 'channel': 'stable'})
            self.assertFalse((Path(temporary) / 'current/public-release.json').exists())

if __name__ == '__main__': unittest.main()
