#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
qa_dir="$repo_root/_qa/preuve-pilotage"
mkdir -p "$qa_dir/home"

# Keep Playwright's existing browser cache visible before isolating HOME.
if [[ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" && -d "$HOME/.cache/ms-playwright" ]]; then
  export PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright"
fi
export HOME="$qa_dir/home"

cd "$repo_root"
npx vitest run --configLoader runner --config tests/e2e/vitest.pilotage.config.ts \
  tests/e2e/pilotage-langage-naturel.test.ts "$@" \
  2>&1 | tee "$qa_dir/demonstration.log"
