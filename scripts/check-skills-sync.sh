#!/usr/bin/env bash
# The Claude Code skill lives twice on purpose:
#   skills/code-buddy         -> Claude Code plugin (.claude-plugin/plugin.json) and `npx skills add phuetz/code-buddy`
#   .claude/skills/code-buddy -> auto-loaded when this repo is the working project
# They must stay byte-identical. Run from the repo root.
set -euo pipefail
if ! diff -q skills/code-buddy/SKILL.md .claude/skills/code-buddy/SKILL.md >/dev/null; then
  echo "skills/code-buddy/SKILL.md and .claude/skills/code-buddy/SKILL.md differ — copy one over the other" >&2
  exit 1
fi
echo "skills in sync"
