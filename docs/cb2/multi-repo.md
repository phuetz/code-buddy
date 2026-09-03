# Multi-repository workspaces

Code Buddy can search and read across a declared set of Git repositories. The feature is opt-in and read-only: it is active only when `CODEBUDDY_WORKSPACE=true` and at least one valid repository is present in a `workspace.json` file.

## Configuration

Code Buddy first looks for `.codebuddy/workspace.json` at the current Git repository root, then falls back to `~/.codebuddy/workspace.json`. A project configuration takes precedence over the user configuration. Relative repository paths are resolved from the directory containing `workspace.json`; canonical absolute paths are stored in memory with `realpath`.

```json
{
  "repos": [
    {
      "name": "code-buddy",
      "path": "/work/code-buddy",
      "description": "Main coding agent"
    },
    {
      "name": "code-explorer",
      "path": "/work/code-explorer"
    }
  ]
}
```

Every path must exist, be a directory, and have a `.git` marker. Invalid entries and duplicate names are logged and ignored; malformed configuration never crashes agent startup. If no valid entry remains, workspace tools stay disabled.

Enable the feature for a process with:

```bash
CODEBUDDY_WORKSPACE=true buddy
```

## CLI

The management command can create and edit the resolved configuration:

```bash
buddy ws list
buddy ws add code-buddy /work/code-buddy
buddy ws rm code-buddy
CODEBUDDY_WORKSPACE=true buddy ws search "ToolHandler" --repo code-buddy
```

`list`, `add`, and `rm` manage configuration explicitly. `search` still requires the environment opt-in.

## Agent tools and limits

- `workspace_search` runs the existing ripgrep-based search engine once per selected repository. Matches use `repoName:relative/path:line` prefixes. Results default to 50 and are capped at 200 across all repositories. `CODEBUDDY_WORKSPACE_TIMEOUT_MS` sets the global timeout in milliseconds (default `30000`).
- `workspace_read` reads a repository-relative file, with optional zero-based `offset` and line `limit`. `CODEBUDDY_WORKSPACE_MAX_FILE_KB` controls the maximum source file size (default `512`).

Both tools are read-only and marked `fleetSafe`. Repository roots and every matched or read path are checked using canonical paths. Absolute paths, `..` traversal, and symlinks escaping a repository are rejected. P0 performs no indexing, embedding, Code Explorer integration, or write inside a configured repository.
