#!/usr/bin/env bash
set -euo pipefail
repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
# Network/filesystem operations are substituted; real deployment is tested separately.
docker run --rm -i -v "$repo_dir:/source:ro" python:3.13-slim-bookworm \
  python3 /source/tests/fixtures/bootstrap-test.py
