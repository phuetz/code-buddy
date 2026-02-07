---
name: session-logs
version: 1.0.0
description: Search and analyze Code Buddy session logs and conversation history
author: Code Buddy
tags: sessions, logs, history, analysis, cost
---

# Session Logs

## Overview

Search and analyze your own session logs to find past conversations, track usage, and review costs.

## Location

Session data is stored in `.codebuddy/sessions/` in the project directory.

## Common Queries

### List sessions by date
```bash
ls -lt .codebuddy/sessions/*.json | head -20
```

### Search across all sessions
```bash
rg -l "search term" .codebuddy/sessions/
```

### Extract user messages from a session
```bash
jq '.messages[] | select(.role == "user") | .content' .codebuddy/sessions/<session>.json
```

### Extract assistant responses
```bash
jq '.messages[] | select(.role == "assistant") | .content' .codebuddy/sessions/<session>.json
```

### Get tool usage breakdown
```bash
jq '[.messages[] | select(.role == "assistant") | .tool_calls[]? | .function.name] | group_by(.) | map({tool: .[0], count: length}) | sort_by(-.count)' .codebuddy/sessions/<session>.json
```

### Calculate session cost
```bash
jq '.usage.totalCost // "unknown"' .codebuddy/sessions/<session>.json
```

### Find sessions that used a specific tool
```bash
for f in .codebuddy/sessions/*.json; do
  if jq -e '.messages[] | select(.role == "assistant") | .tool_calls[]? | select(.function.name == "bash")' "$f" > /dev/null 2>&1; then
    echo "$f"
  fi
done
```

## Tips

- Use `jq` for structured queries on JSON session files
- Use `rg` (ripgrep) for fast full-text search across all sessions
- Combine with `sort`, `uniq -c` for frequency analysis
- Export a session summary: pipe jq output to a markdown file
