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
| `initialize` | Capability negotiation (`protocolVersion: 1`, text prompts). |
| `session/new` | Returns a `sessionId`; records the editor `cwd`. |
| `session/list` | Lists in-process sessions, with optional exact `cwd` filtering and prompt-derived metadata. |
| `session/load` | Reloads an existing in-process session, replays prior `session/update` history, and refreshes the session `cwd`. |
| `session/prompt` | Runs the prompt, streams `session/update` `agent_message_chunk` notifications, resolves with `{ stopReason }`. |
| `session/cancel` | Aborts the active turn → `stopReason: "cancelled"`. |

The stdio transport can also issue agent→client JSON-RPC requests and await
their responses. This is the protocol primitive needed for future
`fs/read_text_file`, `fs/write_text_file`, and `session/request_permission`
integration with editors that expose those client methods. Optional filesystem
requests are gated by the `clientCapabilities` advertised during `initialize`,
as required by the ACP spec.

## Out of scope for v1 (not stubbed — deliberately deferred)

- Full tool-running integration over `fs/read_text_file`,
  `fs/write_text_file`, and `session/request_permission`.
- Durable cross-process session list/load/resumption and MCP passthrough.
- Full tool-using agentic turns (v1 bridges to a one-shot LLM completion).

Implementation: `src/protocols/acp/acp-stdio-server.ts` (protocol layer,
transport-agnostic + tested) and `src/commands/cli/acp-command.ts` (the real
LLM-backed runner). Protocol tests: `tests/protocols/acp-stdio-server-real.test.ts`.
