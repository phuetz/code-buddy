# CLI Reference

Efficiency is the cornerstone of the `@phuetz/code-buddy` ecosystem. By providing a robust command-line interface, we allow developers to interact with the codebase without leaving their terminal, effectively bypassing the overhead of GUI-based tools.

When you invoke a command, the CLI parses your input and routes it to the appropriate handler because the system needs to maintain strict separation between user intent and execution logic. This [architecture](./architecture.md) ensures that even with over 14,000 functions, the CLI remains responsive and predictable.

## Approvals

Code reviews often become the primary bottleneck in the development lifecycle. Automating the approval process allows teams to maintain velocity without sacrificing quality, which is why the `approvals` module exists.

To manage these workflows, use the following commands:

| Command | Params | Description |
| :--- | :--- | :--- |
| `buddy approve <id>` | `id` (string) | Approves a pending code review request. |
| `buddy reject <id>` | `id` (string) | Rejects a pending code review request. |

*Example usage:*
```bash
buddy approve PR-1083
```

> **Developer Tip:** Always run `buddy status` before approving to ensure the latest CI checks have passed, preventing accidental merges of broken builds.

## Keybindings

Context switching is the silent killer of productivity. By mapping complex, multi-step operations to simple key combinations, developers can reclaim their flow state, which is why we implemented the `keybindings-handler`.

The system processes these bindings by intercepting terminal input streams and mapping them to internal function calls.

```mermaid
graph LR
    A[Terminal Input] --> B[CLI Parser]
    B --> C[Keybindings Handler]
    C --> D[Action Execution]
```

| Command | Params | Description |
| :--- | :--- | :--- |
| `buddy bind <key> <action>` | `key`, `action` | Maps a key to a specific system action. |
| `buddy unbind <key>` | `key` | Removes an existing key mapping. |

*Example usage:*
```bash
buddy bind ctrl+shift+a "approve --force"
```

> **Developer Tip:** Use the `buddy list-bindings` command frequently to avoid overlapping key combinations that might conflict with your shell's native shortcuts.

## [Error Handling](./interfaces.md#error-handling)

Robust systems must fail gracefully to prevent data corruption. We utilize standard exit codes to communicate status, ensuring that CI/CD pipelines can react appropriately to failures.

Whenever an operation fails, the system logs the error to `stderr` and exits with a non-zero code because this allows automated scripts to halt execution immediately.

*   `1`: General error (invalid arguments).
*   `2`: Permission denied.
*   `3`: Resource not found.

> **Developer Tip:** Pipe the output of failed commands to `buddy logs --last` to retrieve the full stack trace for debugging purposes.

---

**See also:** [API Reference](./api-reference.md)
