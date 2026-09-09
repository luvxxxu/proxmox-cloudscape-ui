import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('configure_proxy', ROOT / 'deploy/configure-proxy.py')
proxy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proxy)


class ConfigureProxyTests(unittest.TestCase):
    def test_pasted_addresses(self):
        self.assertEqual(proxy.origin('182.215.187.108', True), 'https://182.215.187.108:8006')
        self.assertEqual(proxy.origin('pve.lxvu.dev'), 'https://pve.lxvu.dev')
        self.assertEqual(proxy.origin('https://pve.example.com/#v1:0:=node'), 'https://pve.example.com')
        self.assertEqual(proxy.origin('https://pve.example.com:443/'), 'https://pve.example.com')
        self.assertEqual(proxy.origin('pve.example.com', True), 'https://pve.example.com')

    def test_reject_unsafe_origins(self):
        for value in ('', 'https://user:pass@pve.test', 'http://pve.test', 'pve.test/api', 'pve.test?token=x',
                      'pve.test\ninclude /etc/*;', 'pve.test:8080', 'https://999.1.1.1', 'pve..test', '-pve.test', 'https://pve.test:0'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                proxy.origin(value)

    def test_only_internal_listener_and_peer(self):
        for value in ('182.215.187.108', '0.0.0.0', '224.0.0.1', '::1', '10.1.1.1; allow all;', '10.0.0.0/8'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                proxy.private_ipv4(value)

    def test_render_retains_upload_console_and_auth_controls(self):
        nginx, caddy = proxy.render('https://pve.lxvu.dev', '10.0.0.20:8080', '10.0.0.10', (ROOT / 'deploy/nginx.conf').read_text())
        self.assertNotIn('ssl_certificate', nginx)
        self.assertNotIn('listen 443', nginx)
        self.assertNotIn('listen 80;', nginx)
        self.assertIn('listen 10.0.0.20:8080;', nginx)
        self.assertIn('deny all;', nginx)
        self.assertIn('allow 10.0.0.10;', nginx)
        self.assertIn('return 421', nginx)
        self.assertIn('proxy_set_header X-Forwarded-Proto https;', nginx)
        for text in ('client_max_body_size 16k;', 'client_max_body_size 64g;', 'location /ws', 'proxy_request_buffering off;', 'error_log /dev/null;'):
            self.assertIn(text, nginx)
        self.assertIn('reverse_proxy http://10.0.0.20:8080', caddy)
        self.assertIn('header_up Host pve.lxvu.dev', caddy)

    def test_invalid_ports_and_loopback_listener(self):
        template = (ROOT / 'deploy/nginx.conf').read_text()
        for port in ('443', '3000', '65536', '8080;'):
            with self.subTest(port=port), self.assertRaises(ValueError):
                proxy.render('https://ui.test', '10.0.0.20:' + port, '10.0.0.10', template)
        nginx, _ = proxy.render('https://ui.test', '127.0.0.1:8080', '127.0.0.1', template)
        self.assertEqual(nginx.count('listen 127.0.0.1:8080;'), 1)


if __name__ == '__main__':
    unittest.main()
