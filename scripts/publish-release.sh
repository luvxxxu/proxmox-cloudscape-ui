#!/usr/bin/env bash
set -euo pipefail
: "${RELEASE_VERSION:?}" "${GITHUB_REPOSITORY:?}"
# A draft hides partially uploaded assets from anonymous installers. Published
# versions are never overwritten; failed draft uploads can safely be resumed.
if gh release view "$RELEASE_VERSION" --json isDraft --jq '.isDraft' > build/release-is-draft 2>/dev/null; then
  [[ $(cat build/release-is-draft) == true ]] || { echo 'This version is already published; choose a new version.' >&2; exit 1; }
else
  gh release create "$RELEASE_VERSION" --verify-tag --draft --title "$RELEASE_VERSION" --notes-file docs/release-notes.md
fi
gh release upload "$RELEASE_VERSION" build/release.json build/runtime-linux-x64.tar.gz build/source.tar.gz build/install.sh --clobber
gh release edit "$RELEASE_VERSION" --draft=false --latest
