#!/usr/bin/env bash
set -euo pipefail
# Export the exact image exercised by the browser smoke test. No host binaries.
[[ ${GITHUB_SHA:-} =~ ^[a-f0-9]{40}$ ]] || { echo 'GITHUB_SHA is required' >&2; exit 1; }
[[ ${GITHUB_REPOSITORY:-} =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || exit 1
image=${1:?Usage: package-runtime.sh IMAGE}
stage=$(mktemp -d)
container=$(docker create --platform linux/amd64 "$image")
trap 'docker rm "$container" >/dev/null; rm -rf "$stage"' EXIT
[[ $(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image") == linux/amd64 ]] || exit 1
[[ $(docker run --rm --platform linux/amd64 --network none --entrypoint node "$image" -p 'process.versions.node.split(".")[0]') == 24 ]] || exit 1
docker cp "$container:/app/." "$stage/"
mkdir -p "$stage/node/bin"
docker cp "$container:/usr/local/bin/node" "$stage/node/bin/node"
rm -rf "$stage/.next/cache"
mkdir -p "$stage/.next/cache" build
node --input-type=module - "$stage/release.json" <<'JS'
import {writeFileSync} from 'node:fs';
writeFileSync(process.argv[2], JSON.stringify({commit:process.env.GITHUB_SHA, repository:process.env.GITHUB_REPOSITORY, platform:'linux-x64', nodeMajor:24})+'\n');
JS
# Use GNU tar from the tested Debian image, also when invoked from macOS.
# Flatten hard links while preserving dependency symlinks inside the runtime.
docker run --rm --platform linux/amd64 --network none --user 0:0 --read-only \
  --cap-drop ALL --security-opt no-new-privileges \
  -v "$stage:/runtime:ro" -v "$PWD/build:/output" --entrypoint tar "$image" \
  --hard-dereference --owner=0 --group=0 -czf /output/runtime.tar.gz -C /runtime \
  .next node_modules public server package.json next.config.mjs release.json node
