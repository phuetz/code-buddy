#!/usr/bin/env bash
cd "$HOME/code-buddy" || exit 1
P=/tmp/claude-1000/-home-patrice-code-buddy/1be8e88b-5f6f-4064-95fc-6e5cf373b124/scratchpad/mission-ambre-editorial.txt
codex exec -c sandbox_mode=danger-full-access "$(cat "$P")" >> "$HOME/code-buddy/ambre-editorial.log" 2>&1 < /dev/null
