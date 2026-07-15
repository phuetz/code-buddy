# Shadow workspace

The shadow workspace is an opt-in write gate that validates proposed file contents in a detached Git worktree before Code Buddy changes the real working tree. Enable it with:

```bash
CODEBUDDY_SHADOW_WORKSPACE=true buddy
```

When the variable is absent or has any value other than the exact string `true`, the shadow module is not loaded and file-writing behavior is unchanged.

## Configuration

| Variable | Meaning | Default |
|---|---|---|
| `CODEBUDDY_SHADOW_WORKSPACE` | Enables speculative validation when exactly `true` | disabled |
| `CODEBUDDY_SHADOW_CMD` | Shell command executed in the shadow worktree | auto-detected |
| `CODEBUDDY_SHADOW_TIMEOUT_MS` | Validation and setup command timeout in milliseconds | `120000` |

Without `CODEBUDDY_SHADOW_CMD`, Code Buddy selects `npm run typecheck` when `package.json` defines a `typecheck` script, then falls back to `npx tsc --noEmit` when `tsconfig.json` exists. If neither check is available, the shadow is inactive and writes pass through.

`buddy shadow status` displays the repository, persistent worktree path, selected validator, timeout, and whether the worktree has been created. `buddy shadow run` copies the current tracked modifications and untracked files into the shadow and runs the effective validator.

## Architecture

All file-writing tools meet at the shared write-gate plumbing after user confirmation. With the feature enabled, the plumbing lazily obtains one `ShadowWorkspace` per repository and sends it the complete proposed contents. Multi-file patches are validated as one batch.

The workspace is stored outside the project at `~/.codebuddy/shadow/<sha256-of-repository-path>/`. On its first run it is created with `git worktree add --detach`. Before every uncached validation it checks out the real repository's current `HEAD` in detached mode and removes artifacts from the preceding attempt. Proposed contents are then written only in the shadow. If the main repository has `node_modules`, the shadow links to it; it never runs `npm install`.

Successful batches are cached in memory for the process session by relative path and SHA-256 content hash. Repeating an identical validated proposal does not create a subprocess. Failed results are not cached.

A validator exit failure or validation timeout returns a structured `shadow validation failed` tool error, including the last 4,000 output characters, and the real write is not applied. Setup failures such as a missing Git repository are different: they are logged and fail open so shadow infrastructure can never block a real write. Existing diff-review behavior still runs after a successful or unavailable shadow check when enabled separately.

## Limits

- Validation starts from committed `HEAD`, plus only the complete contents proposed by the current write. Unrelated dirty files in the main working tree are intentionally absent. The diagnostic `shadow run` is the exception and copies current non-ignored changes.
- The default validator is project-wide. Use `CODEBUDDY_SHADOW_CMD` for targeted tests or a combined typecheck/test command.
- Only successful proposals are cached, and the cache lasts for one process session.
- The worktree is persistent but disposable. Git metadata and the real working tree are never removed by shadow cleanup.
- Commands execute with the user's local permissions and environment. The shadow is an isolation mechanism for file contents, not a security sandbox for the validation command.
