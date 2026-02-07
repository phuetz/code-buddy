---
name: tmux-sessions
version: 1.0.0
description: Manage tmux sessions for running background processes, dev servers, and parallel tasks
author: Code Buddy
tags: tmux, terminal, sessions, background, parallel
---

# Tmux Sessions

## Overview

Use tmux to manage background processes, run dev servers, and execute parallel tasks without blocking the main terminal.

## Quick Reference

### Create and manage sessions
```bash
# New named session
tmux new-session -d -s dev-server

# List sessions
tmux list-sessions

# Attach to session
tmux attach -t dev-server

# Kill session
tmux kill-session -t dev-server
```

### Send commands to a session
```bash
# Run a command in a detached session
tmux send-keys -t dev-server 'npm run dev' Enter

# Send Ctrl+C to stop
tmux send-keys -t dev-server C-c
```

### Read session output
```bash
# Capture last 200 lines of output
tmux capture-pane -p -t dev-server -S -200
```

## Common Patterns

### Dev Server in Background
```bash
tmux new-session -d -s server
tmux send-keys -t server 'npm run dev' Enter
# ... work on other things ...
tmux capture-pane -p -t server -S -50  # Check logs
tmux send-keys -t server C-c           # Stop server
tmux kill-session -t server
```

### Parallel Test Runs
```bash
tmux new-session -d -s test-unit
tmux new-session -d -s test-e2e
tmux send-keys -t test-unit 'npm run test:unit' Enter
tmux send-keys -t test-e2e 'npm run test:e2e' Enter
# Check results
tmux capture-pane -p -t test-unit -S -20
tmux capture-pane -p -t test-e2e -S -20
```

### Watch Build Output
```bash
tmux new-session -d -s build
tmux send-keys -t build 'npm run build:watch' Enter
# Periodically check
tmux capture-pane -p -t build -S -10
```

## Tips

- Always use `-d` (detached) when creating sessions from scripts
- Use descriptive session names: `dev-server`, `test-runner`, `build-watch`
- Clean up sessions when done: `tmux kill-server` removes all
- For interactive TUI apps, send text and Enter separately with a small delay:
  ```bash
  tmux send-keys -t target -l "command" && sleep 0.1 && tmux send-keys -t target Enter
  ```
- Capture output with `-S -200` to get enough context (last 200 lines)
