# ACP editor integration (`buddy acp`)

Code Buddy can run as an [Agent Client Protocol](https://agentclientprotocol.com)
agent so editors that speak ACP (e.g. **Zed**) can drive it as an agent
subprocess. The agent communicates over **newline-delimited JSON-RPC 2.0 on
stdio** — `stdout` is reserved for the protocol, all logs go to `stderr`.

```bash
buddy acp        # speaks ACP on stdin/stdout; editors spawn this, you don't run it by hand
```

## Zed configuration

Add to `~/.config/zed/settings.json`:

```json
{
  "agent_servers": {
    "Code Buddy": { "command": "buddy", "args": ["acp"] }
  }
}
```

The agent uses your configured provider (auto-detected via the usual keys —
`GROK_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `buddy login`).

> **Status:** message shapes are grounded in the published ACP spec and
> round-trip tested (`tests/protocols/acp-stdio-server-real.test.ts`), but this
> has not yet been validated against a live editor — try it in Zed and report
> any handshake mismatches.

## Supported methods (v1)

| Method | Behavior |
|---|---|
| `initialize` | Capability negotiation (`protocolVersion: 1` only, text prompts). |
| `session/new` | Returns a `sessionId`; records the editor `cwd`. |
| `session/list` | Lists in-process sessions newest first, with optional exact `cwd` filtering and prompt-derived metadata retained even when a prompt fails. |
| `session/load` | Reloads an existing in-process session, replays prior `session/update` history, and refreshes the session `cwd` / `updatedAt`; rejected while a prompt is active. |
| `session/prompt` | Runs a valid prompt array of text content blocks, streams `session/update` `agent_message_chunk` notifications, resolves with `{ stopReason }`; malformed payloads/content blocks, unsupported block types, or concurrent prompts for the same session are rejected before the runner starts. |
| `session/cancel` | Aborts the active turn → `stopReason: "cancelled"`; notification form is silent, valid request form returns `null`. |

The stdio transport can also issue agent→client JSON-RPC requests and await
their responses. This is the protocol primitive needed for future
`fs/read_text_file`, `fs/write_text_file`, and `session/request_permission`
integration with editors that expose those client methods. Optional filesystem
requests are gated by the `clientCapabilities` advertised during `initialize`,
as required by the ACP spec. Active prompts use the capabilities snapshot from
the moment the prompt starts, so a later `initialize` cannot grant or revoke
client filesystem access mid-turn. Unknown agent→client method names are
rejected instead of being forwarded to the editor. Unanswered agent→client
requests time out after 120 seconds so a closed or stalled editor cannot leave a
turn hanging forever. Editor→agent ACP requests expect JSON object `params`;
array/primitive params are rejected as JSON-RPC `-32602 Invalid params` instead
of being coerced into defaults. Client responses to agent→client requests must
also use a JSON-RPC 2.0 envelope; malformed responses reject the pending request
instead of satisfying it.

## Out of scope for v1 (not stubbed — deliberately deferred)

- Full tool-running integration over `fs/read_text_file`,
  `fs/write_text_file`, and `session/request_permission`.
- Durable cross-process session list/load/resumption and MCP passthrough.
- Full tool-using agentic turns (v1 bridges to a one-shot LLM completion).

Implementation: `src/protocols/acp/acp-stdio-server.ts` (protocol layer,
transport-agnostic + tested) and `src/commands/cli/acp-command.ts` (the real
LLM-backed runner). Protocol tests: `tests/protocols/acp-stdio-server-real.test.ts`.
