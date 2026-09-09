#!/usr/bin/env bash
set -euo pipefail
# Runs only in the disposable Debian container created by check-deployment.sh.
installer=/source/deploy/install-systemd.sh
built_dir=/tmp/untrusted-built
cp -a /tmp/fixture "$built_dir"
printf '#!/bin/sh\ntouch /tmp/untrusted-installer-executed\n' > "$built_dir/deploy/install-systemd.sh"
printf 'UNTRUSTED_UNIT\n' > "$built_dir/deploy/proxmox-cloudscape.service"
printf 'SESSION_SECRET=untrusted-build-secret\n' > "$built_dir/.env.local.example"
rm /etc/proxmox-cloudscape/environment
bash "$installer" --source-dir "$built_dir"
test ! -e /tmp/untrusted-installer-executed
cmp /source/deploy/proxmox-cloudscape.service /etc/systemd/system/proxmox-cloudscape.service
grep -q '^SESSION_SECRET=$' /etc/proxmox-cloudscape/environment

mkdir -m 0700 /tmp/protected-outside
touch /tmp/protected-outside/marker
chmod 0600 /tmp/protected-outside/marker
current=$(readlink /opt/proxmox-cloudscape/current)
for part in .next node_modules public server .next/cache .next/BUILD_ID package.json next.config.mjs; do
  rm -rf /tmp/symlink-built
  cp -a "$built_dir" /tmp/symlink-built
  rm -rf "/tmp/symlink-built/$part"
  ln -s /tmp/protected-outside "/tmp/symlink-built/$part"
  if bash "$installer" --source-dir /tmp/symlink-built > /tmp/symlink-rejection 2>&1; then
    echo "FAIL: the installer accepted a symlink at $part." >&2
    exit 1
  fi
  test "$(readlink /opt/proxmox-cloudscape/current)" = "$current"
  test "$(stat -c %U /tmp/protected-outside)" = root
  test "$(stat -c %a /tmp/protected-outside/marker)" = 600
done

# Normal package symlinks must remain usable, without recursively changing the
# ownership or mode of any target outside the release, including inside cache.
mkdir -p "$built_dir/.next/cache"
ln -s /tmp/protected-outside "$built_dir/.next/cache/external-link"
ln -s ../package.json "$built_dir/node_modules/package-link"
bash "$installer" --source-dir "$built_dir"
current=$(readlink /opt/proxmox-cloudscape/current)
test -L "$current/node_modules/package-link"
test -L "$current/.next/cache/external-link"
test "$(stat -c %U /tmp/protected-outside)" = root
test "$(stat -c %a /tmp/protected-outside/marker)" = 600

# Simulate a build account replacing cache after source validation but before
# rsync copies it. Validation of the private root-owned destination must reject it.
mkdir /tmp/source-race-bin
cat > /tmp/source-race-bin/rsync <<'RACE_RSYNC'
#!/bin/bash
set -euo pipefail
for argument in "$@"; do
  case "$argument" in
    /tmp/untrusted-built/.next)
      rm -rf "$argument/cache"
      ln -s /tmp/protected-outside "$argument/cache"
      ;;
  esac
done
exec /usr/bin/rsync "$@"
RACE_RSYNC
chmod 0755 /tmp/source-race-bin/rsync
if PATH="/tmp/source-race-bin:$PATH" bash "$installer" --source-dir "$built_dir" > /tmp/source-race-rejection 2>&1; then
  echo 'FAIL: a cache symlink introduced during the copy was accepted.' >&2
  exit 1
fi
grep -q 'cache must be a real directory' /tmp/source-race-rejection
test "$(readlink /opt/proxmox-cloudscape/current)" = "$current"
test "$(stat -c %U /tmp/protected-outside)" = root
test "$(stat -c %a /tmp/protected-outside/marker)" = 600
echo 'PASS: trusted installer inputs, separate build source, symlink rejection before/after copying, and outside-path ownership protection.'
