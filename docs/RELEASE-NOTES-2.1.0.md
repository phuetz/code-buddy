# Code Buddy 2.1.0

This release improves everyday terminal work, desktop workflows and explicit cooperation with other tools and agents.

## Everyday use

- Compaction before tool execution preserves calls still in progress; their real results reach the next model turn, including with small local context windows. Historical missing-result repair remains active.

- A failed persona directory watcher stops hot reload with a diagnostic instead of terminating the process; already-loaded personas remain usable, including on Windows Node 20.

- Slash command discovery and help share a catalog; model, theme and configuration information reflect the running session.
- Conversation exports retain their content, and terminal conversations can be saved and resumed.
- Facts-memory clients follow the active agent turn, including headless and desktop execution, without leaking another session’s provider through a shared fallback cache.
- `buddy doctor --offline` diagnoses project configuration without restoring or rewriting damaged settings. Normal readers retain their documented recovery behavior; explicit repairs remain separate.
- Tool schemas stay complete when MCP tools are selected, including the non-RAG path. Loop detection compares supported repeated task results without treating a fresh task identifier alone as progress.

## Integrations and cooperation

- The [resource catalog](integrations/resource-catalog-tools.md) lists explicitly configured resources and selects compatible, recently observed candidates. Unknown measurements remain unknown. Listing does not probe services, and selection does not replay work or provide coordinator high availability.
- [RagChat search](integrations/ragchat.md) retrieves authorized documents with page citations through an existing API. RagChat remains a separate service. Low-quality or rotated scans still require OCR quality checks; an indexed document is not proof of readable extraction.
- [MCP import](integrations/mcp-import.md) normalizes supported Hermes/OpenClaw configuration subsets, filters native tool names, preserves secret references and supports SDK SSE and Streamable HTTP. OAuth credentials are not transferred. Imported stdio programs still require operator trust.
- The optional [A2A JSON-RPC bridge](integrations/a2a-jsonrpc.md) supports bounded text messages and task lookup between declared peers. It preserves authentication and read-only workspace restrictions. Streaming, cancellation, media and durable task recovery are not supported by this bridge.

## Cowork

Fleet navigation, native workflow editing and skill execution receive targeted fixes. Cowork is built and distributed separately from the npm terminal package; installing the CLI does not install an Electron desktop application.

## Install and verify

```sh
npm install -g @phuetz/code-buddy@2.1.0
buddy --version
buddy doctor --offline
```

Use Node.js 20 or newer. A fresh profile may produce diagnostic warnings until a provider and optional services are configured. Existing login credentials are not part of the package. `buddy login` starts the supported ChatGPT sign-in flow when needed.

## Programmatic tool lifecycle

Sandboxed `code_exec` waits for the child process and its streams to close before returning. If closure is not confirmed within the bounded grace period, the tool returns a failure and preserves the original diagnostic. This prevents callers from treating a still-occupied workspace as ready for cleanup.

## Scope of validation

Release acceptance requires the candidate’s CI checks, package inspection and documented platform recipes. Historical test counts and earlier packages carrying version 2.0.0 do not identify this build. See [the release procedure](RELEASING.md) for the immutable-tag and provenance checks. These changes do not promise universal interoperability, perfect model answers or automatic conversion of every memory into a reusable skill; [learning mechanisms](learning-mechanisms.md) describes those distinct paths.
