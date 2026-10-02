# ACP editor integration (`buddy acp`)

Code Buddy runs as an [Agent Client Protocol](https://agentclientprotocol.com)
agent over newline-delimited JSON-RPC 2.0 on stdio. The editor starts the
subprocess; stdout carries only ACP messages and logs go to stderr.

**Statut du lot ACP v2 : validé par le client de référence ACP ; pas encore
essayé dans Zed par un humain.** The implementation uses the stable ACP wire
protocol (`protocolVersion: 1`). “ACP v2” names this Code Buddy delivery; it does
not enable the SDK's experimental ACP v2 wire protocol.

## Zed configuration

Add this entry to Zed's `settings.json` ([custom-agent documentation](https://zed.dev/docs/ai/external-agents#custom-agents)):

```json
{
  "agent_servers": {
    "Code Buddy": {
      "type": "custom",
      "command": "buddy",
      "args": ["acp", "--permission-mode", "default"]
    }
  }
}
```

`buddy` must be on the editor's PATH. The subprocess uses the normal provider
configuration (provider keys, configured local endpoint, or `buddy login`).
Without a configured provider it returns `refusal` with an explanatory message.
Use `--profile <name>` for a named Code Buddy profile. Permission modes such as
`plan` and `acceptEdits` apply as they do in the interactive CLI.

## Methods and updates

| Direction / method | Behavior |
|---|---|
| Client → `initialize` | Negotiates stable ACP version 1, text prompts, session loading/listing and filesystem capabilities. HTTP/SSE MCP capabilities are false. |
| Client → `session/new` | Creates a session with its cwd and supplied stdio MCP servers. |
| Client → `session/list` | Lists durable sessions, optionally filtered by exact cwd. |
| Client → `session/load` | Restores the saved model conversation, replays user/agent/tool updates and refreshes cwd/MCP configuration. Active sessions cannot be loaded. |
| Client → `session/prompt` | Runs `CodeBuddyAgent.processUserMessageStream`, the same loop, tools, policy, confirmation service and security guards used by the interactive agent. |
| Agent → `session/update` | Streams `user_message_chunk`, `agent_message_chunk`, available `agent_thought_chunk`, `tool_call`, `tool_call_update` (status, text output and structured edit diffs), and `plan` for task lists/progress. |
| Agent → `session/request_permission` | Publishes the tool call first, then requests allow once, allow always with an explicit scope label, or reject. Refusal, cancellation, malformed outcomes and timeout never authorize the action. |
| Agent → `fs/read_text_file` | Reads the editor's current buffer when `fs.readTextFile` is advertised, including files not yet saved. Otherwise reads from disk. |
| Agent → `fs/write_text_file` | Writes text through the editor when `fs.writeTextFile` is advertised. Otherwise uses the normal disk write after the normal gates. |
| Client → `session/cancel` | Aborts active LLM requests, tool execution and pending editor requests; the prompt resolves with `cancelled`. |

Client capabilities are snapshotted at prompt start. Reads do not gain an extra
permission prompt merely because they use the editor. Actions requiring
interactive approval still go through `ConfirmationService`; its policy and
permission-mode denials precede the editor bridge. ACP itself does not switch on
auto-confirm or headless auto-approval. “Always” grants are session-local and do
not survive process restart or a change of session cwd. Internal file approvals
grant the file-operation category, as in the interactive CLI; the option label
states this scope. Generic tool approvals instead grant the exact call, including
its arguments and cwd.

Shared tool instances resolve their confirmation service and working directory
at each call through asynchronous context. Internal declarative permission rules
are read from the session directory, including rules that deny edits. Search
cache keys include the working directory, and dynamic permission grants belong
to the calling session.

Text tools (`view_file`, `create_file`, string/line editing, Morph and add/update
`apply_patch`) use the normal VFS boundary. Paths resolve against the session cwd;
workspace, credential and symlink protections run before editor IO. Shell
commands operate on the session's physical working directory, as in the interactive CLI.
Direct VFS calls and core filesystem operations resolve relative paths through
the calling context too; a relative subprocess `cwd` resolves inside that session.
Core disk mutations check cancellation immediately before the operation. Tool
subprocesses inherit the turn's cancellation signal; on Linux their process group
or captured descendants are terminated. The runner waits for outstanding operations and cancelled process
closure before completing the prompt, so a new turn cannot overlap unfinished
tool cleanup.

Sessions live under `~/.codebuddy/acp-sessions` (owner-only directory/files).
Snapshots use `src/utils/atomic-write.ts`, and a completed prompt is persisted
before its response is sent. Closing stdin aborts the turn and drains pending
session writes, all accepted requests (including store loading), and their responses
before exit. A prompt still queued at EOF returns `cancelled` without starting
agent work. Model conversation, tool results and displayed
history are retained; replaying history does not execute any tools.

## Reference-client validation

The official npm package `@agentclientprotocol/sdk` is pinned to **1.7.0**, in
**devDependencies only**. `tests/protocols/acp-reference-client.test.ts` uses its
client to launch the real CLI subprocess. A deterministic test-only fetch
provider returns tool calls and streaming tokens without keys or network calls.
Tests cover:

- Reading an unsaved buffer, refusing an edit with zero writes, then allowing
  the edit and inspecting the changed file and structured diff.
- Resuming the model conversation in a second process.
- Cancelling a running command and proving its delayed write never happens;
  separately cancelling a stalled LLM request.
- Closing stdin during a stalled LLM request and receiving the cancelled prompt
  response before process exit. A raw NDJSON subprocess test also closes stdin
  immediately after initialize/new/list/load and checks every response and the
  durable new session.
- Applying a patch to an unsaved buffer, isolating “always” grants between
  sessions, restrictive permission modes and stdio MCP tool invocation.
- Reusing `multi_edit` in two sessions with different directories and a third
  launch directory: B receives its own diff permission after either a one-time or
  persistent approval in A. Relative paths target the same file that was approved,
  on disk and through editor IO.

The patch test fails against the previous runner: the file remains unchanged.
Adapter tests also exercise disk fallback, unanswered/cancelled permissions,
unsaved files, symlink escape refusal, thoughts, task plans and round limits.
Legacy Morph edits also resolve relative paths against the session cwd, validate
workspace containment, and preserve review gates.
Additional real-tool tests cover Git commits in separate repositories, internal
deny rules, grant revocation when cwd changes, and cancellation between two disk
operations. Docker and Kubernetes tests exercise reused tool instances with
simulated binaries. Real subprocess tests cover `spawn`, `execFile` and shell
`exec` cancellation before a delayed write. A separate Linux test cancels
`execFile` from outside the tool context, keeps a descendant that ignores SIGTERM
owned until SIGKILL, and proves its delayed write never happens.

```bash
HOME="$PWD/_qa/acp/home" RUN_REAL_TESTS=1 npm test -- tests/protocols/acp*
HOME="$PWD/_qa/acp/home" npm run typecheck
```

The tests use disposable homes underneath `_qa/acp/home`. `RUN_REAL_TESTS=1`
includes the existing stdio transport suite whose filename contains `real`.

## Current limits

- Human use in Zed, Windows and macOS has not been exercised for this delivery.
- Overlapping turns across different sessions in one subprocess are rejected,
  because some core registries retain process-wide state. Separate agent
  subprocesses can run independently.
- ACP text filesystem methods do not offer deletion or renaming. Editor-routed
  patches containing those operations fail before writing anything.
- Opt-in diff-review/shadow transactions currently require physical disk
  snapshots. Advertising editor reads alone is sufficient for an unsaved buffer
  to differ from the disk, even when writes fall back to disk. Those gated writes
  fail closed;
  the adapter never disables the gate or commits behind the editor.
- MCP passthrough supports stdio only; terminal delegation and non-text prompt
  blocks are not advertised. Arbitrary tools can still report ordinary policy
  or runtime failures through their normal result path.
- A provider or external tool that ignores cancellation can delay prompt
  completion; the runner keeps ownership until it terminates. Third-party MCP
  servers and plugin implementations have not been exhaustively audited for
  their own filesystem effects. Node synchronous operations cannot be interrupted
  in the middle of a blocking call; cancellation is checked before starting them.

Message ordering and filesystem routing were informed by Gemini CLI's
[ACP implementation](https://github.com/google-gemini/gemini-cli/tree/main/packages/cli/src/acp)
and its [permission-ordering fix](https://github.com/google-gemini/gemini-cli/pull/29439)
(Apache-2.0). The implementation here is independent; no source code was copied.
