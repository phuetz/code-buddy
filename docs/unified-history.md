# Unified recents (`buddy session list`, Cowork, mobile)

CLI sessions (`~/.codebuddy/sessions/*.json`), Cowork conversation threads (local SQLite database), and mobile-tagged threads share a single unified **metadata index** (`~/.codebuddy/recents-index.json`).

This allows listing and resuming Cowork sessions directly from `buddy session list` and `buddy session resume` without manual export/import steps.

## Architecture and Storage

- **Index location:** `~/.codebuddy/recents-index.json` (overridable via `CODEBUDDY_RECENTS_INDEX`).
- **Index schema:** Version 1 (`UNIFIED_INDEX_VERSION = 1`). Unknown or outdated versions are automatically discarded and rebuilt from source data.
- **Transcripts:** Message bodies are **not** duplicated into the index. CLI transcripts remain in `~/.codebuddy/sessions/`, while Cowork transcripts remain in `cowork.db`.
- **Handoff:** Resuming a Cowork session from the CLI creates a local bridge session file (`cowork-<id>.json` with mode `0600`) in the CLI session directory on first resume.

## Commands (verified by execution)

```bash
buddy session --help
buddy sessions --help             # "sessions" is a direct alias for "session"
buddy session list                # list recent sessions (default limit: 10)
buddy session list --limit 25     # customize returned session count
buddy sessions ls                 # "ls" alias for "list"
buddy session search "migration"  # search saved sessions by content
buddy session resume              # TTY: interactive picker; non-TTY: list and exit 1
buddy session resume <id>         # resume by exact ID or unique partial prefix
buddy session last                # resume the most recently accessed session
buddy --continue                  # root CLI shortcut to continue last session
buddy --resume [id]               # root CLI shortcut to resume specific session
```

### Command Subcommands and Options

#### `buddy session list` (alias: `ls`)
- `--limit <count>`: Maximum number of sessions to display (default: `10`)

#### `buddy session search <query...>`
- `<query...>`: Search keywords (supports multi-word queries)
- `--limit <count>`: Maximum number of search matches to display (default: `10`)

#### `buddy session resume [sessionId]`
- `[sessionId]`: Session ID or unique prefix. If omitted in a TTY, launches an interactive picker.
- `--limit <count>`: Number of recent sessions offered by the interactive picker (default: `20`)

#### `buddy session last`
- Resumes the most recently accessed session without arguments.

## Real Execution Outputs (Observed)

### 1. `buddy session list` (no sessions found)
```
$ buddy session list
No sessions found.
```
Exit code: 0.

### 2. `buddy session list` (with indexed sessions)
```
$ buddy session list
Recent sessions (1):

  test-123 - Test Session Documenter 2.3
    1 messages | 9/18/2026 2:00:00 AM
    origin: cli

Use `buddy sessions resume <id>` to resume a session
```
Exit code: 0. Displays session ID prefix, title, message count, timestamp, and origin (`cli`, `cowork`, or `mobile`).

### 3. `buddy session search <query>` (no match)
```
$ buddy session search test
No sessions found matching: test
```
Exit code: 0.

### 4. `buddy session resume <id>` (session not found)
```
$ buddy session resume non-existent-id
[2026-09-17T23:47:33.394Z] ❌ ERROR Session not found: non-existent-id

Recent sessions:
```
Exit code: 1.

### 5. `buddy session resume <id>` (successful resume)
```
$ buddy session resume test-123
Resuming session: Test Session Documenter 2.3 (test-123)
   1 messages, last accessed: 9/18/2026, 2:00:00 AM
   Recap (local, no model call): 0 user / 0 assistant turns, 0 tool call(s)
```
Exit code: 0.

## Profile and Identity Isolation

- **Profile Filtering:** When `CODEBUDDY_PROFILE` is set, sessions tagged with a different profile are filtered out from the list. Untagged sessions remain visible. Profiles are never blended together.
- **Owner Isolation:** When `CODEBUDDY_OWNER_USER_ID` is configured, records associated with another owner ID are excluded.
- **Ambiguous Prefix Guard:** Partial ID matching requires a unique prefix. If an abbreviated ID matches more than one session, resolution returns null to avoid resuming the wrong session.

## What this feature does NOT do

- **Does NOT copy message bodies into the index:** The index stores only metadata (`id`, `title`, `origin`, `createdAt`, `updatedAt`, `messageCount`, `pointer`). Transcripts remain in their original stores.
- **Does NOT synchronize sessions over the network or cloud:** The index is strictly local to the machine filesystem.
- **Does NOT modify Cowork’s SQLite database:** Cowork's SQLite database is opened in read-only mode (`readonly: true`).
- **Does NOT fail if SQLite or Cowork is missing:** If `cowork.db` or `better-sqlite3` is unavailable, the index gracefully falls back to CLI sessions without error.
- **Does NOT merge profiles:** Setting `CODEBUDDY_PROFILE=team-b` will not expose sessions created under `team-a`.
- **Does NOT hang on interactive prompts without a TTY:** Calling `buddy session resume` without an ID in a headless or piped environment prints available sessions and exits with code 1 immediately.
- **Does NOT leak secrets in session titles:** Session titles pass through the redaction engine (`redactTitle`) before being indexed.
