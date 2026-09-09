#!/usr/bin/env python3
"""Validate installer input and render a restricted HTTP upstream for Caddy."""
import ipaddress
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit


PRIVATE_NETWORKS = tuple(map(ipaddress.ip_network, ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8')))


def private_ipv4(value):
    address = ipaddress.IPv4Address(value)
    if not any(address in network for network in PRIVATE_NETWORKS):
        raise ValueError('Caddy 연결에는 공인 IP 대신 내부 IPv4 또는 VPN 내부 IPv4를 사용하세요.')
    return str(address)


def origin(value, proxmox=False):
    value = value.strip()
    if not value or any(c.isspace() for c in value):
        raise ValueError('접속 주소를 입력하세요. 공백은 사용할 수 없습니다.')
    if '://' not in value:
        # A bare Proxmox IP means its native API port. DNS names commonly use Caddy/443.
        try:
            ipaddress.IPv4Address(value)
            value += ':8006' if proxmox else ''
        except ValueError:
            pass
        value = 'https://' + value
    parsed = urlsplit(value)
    hostname = parsed.hostname or ''
    if (parsed.scheme != 'https' or parsed.username is not None or parsed.password is not None
            or parsed.path not in ('', '/') or parsed.query or not hostname
            or not re.fullmatch(r'[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?', hostname)):
        raise ValueError('https://호스트[:포트] 형식만 사용하세요. 경로·계정 정보는 넣지 마세요.')
    if re.fullmatch(r'[0-9.]+', hostname):
        ipaddress.IPv4Address(hostname)
    elif len(hostname) > 253 or any(not re.fullmatch(r'[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?', label) for label in hostname.split('.')):
        raise ValueError('올바른 DNS 이름을 입력하세요.')
    port = parsed.port
    if port == 0 or (not proxmox and port not in (None, 443)):
        raise ValueError('새 UI 주소는 HTTPS 기본 포트 443을 사용해야 합니다.')
    # Browser fragments such as /#v1:... do not belong in an API origin.
    return 'https://' + hostname.lower() + (f':{port}' if port not in (None, 443) else '')


def render(app_origin, binding, proxy_source, template):
    public = origin(app_origin)
    host = urlsplit(public).hostname
    ip, separator, port_text = binding.rpartition(':')
    if not separator or not port_text.isascii() or not port_text.isdigit():
        raise ValueError('내부 수신 주소는 IPv4:포트 형식이어야 합니다.')
    ip = private_ipv4(ip)
    port = int(port_text)
    if not 1024 <= port <= 65535 or port == 3000:
        raise ValueError('내부 프록시 포트는 3000을 제외한 1024~65535 중 선택하세요.')
    peer = private_ipv4(proxy_source)
    # Preserve all request size, streaming, WebSocket, and sensitive log policies.
    start = template.index('server {\n    listen 443 ssl;')
    output = template[:template.index('server {')] + template[start:]
    output = output.replace('    listen 443 ssl;\n    http2 on;\n', f'    listen {ip}:{port};\n' + (f'    listen 127.0.0.1:{port};\n' if ip != '127.0.0.1' else ''))
    output = '\n'.join(line for line in output.split('\n') if not line.lstrip().startswith(('ssl_certificate ', 'ssl_certificate_key ', 'ssl_protocols ')))
    output = output.replace('    server_name proxmox-ui.example.com;', f'''    server_name {host};
    allow 127.0.0.1;
    allow {peer};
    deny all;
    # Reject unexpected hosts before forwarding to the application.
    if ($host != {host}) {{ return 421; }}''')
    output = output.replace('proxy_set_header X-Forwarded-Proto $scheme;', 'proxy_set_header X-Forwarded-Proto https;')
    caddy = f'''# Add this site to the existing Caddyfile on the Caddy LXC.
# Keep the existing Proxmox site. DNS for {host} must point to Caddy.
# Do not enable access logs containing console tickets or OIDC query parameters.
{host} {{
	reverse_proxy http://{ip}:{port} {{
		header_up Host {host}
		flush_interval -1
	}}
}}
'''
    return output, caddy


def main():
    command, *args = sys.argv[1:]
    if command == 'origin' and len(args) == 2:
        print(origin(args[1], args[0] == 'proxmox'))
    elif command == 'private-ip' and len(args) == 1:
        print(private_ipv4(args[0]))
    elif command == 'render' and len(args) == 6:
        app, binding, peer, template, nginx_path, caddy_path = args
        nginx, caddy = render(app, binding, peer, Path(template).read_text())
        Path(nginx_path).write_text(nginx)
        Path(caddy_path).write_text(caddy)
    else:
        raise ValueError('Invalid installer helper arguments.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as error:
        sys.exit(str(error))
