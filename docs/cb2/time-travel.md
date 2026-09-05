# Time-travel sessions

Time-travel sessions add a compact, append-only timeline to normal Code Buddy
sessions. The feature is disabled by default and has no persistence side effect
unless it is explicitly enabled:

```bash
CODEBUDDY_TIMELINE=true buddy
```

At the end of each agent turn, Code Buddy appends one JSONL record to
`~/.codebuddy/timelines/<sessionId>.jsonl`. A record contains only a message
preview (at most 400 characters), tool names and outcomes, touched file paths,
and the checkpoint id associated with file-writing tools. Full message content
continues to live only in the normal session store.

## Replay commands

List the recorded turns:

```bash
buddy replay <sessionId>
```

Inspect a turn and, when it has a checkpoint, choose whether to restore its
files:

```bash
buddy replay <sessionId> --at 3
```

Restoration always asks for interactive confirmation. Automation must opt in
explicitly with `--yes`:

```bash
buddy replay <sessionId> --at 3 --yes
```

Each recorded turn stores a complete working-tree snapshot under
`~/.codebuddy/timelines/snapshots/` (tracked and untracked non-ignored files).
Restore rematerializes **exactly** that tree: files are rewritten to their
contents at that turn, and files created in later turns are removed. The
in-memory `CheckpointManager` is only a same-process fallback.

Fork the canonical session history through a recorded turn without changing the
source session or restoring files:

```bash
buddy replay <sessionId> --at 3 --fork experiment-from-turn-3
```

The requested fork id becomes the exact id of the new session. Existing ids are
never overwritten.

Timeline failures are best-effort: an unreadable or unwritable timeline logs a
warning but never interrupts an agent turn. With `CODEBUDDY_TIMELINE` unset or
set to any value other than `true`, the executor does not install the timeline
hook and creates no timeline directory or file.
