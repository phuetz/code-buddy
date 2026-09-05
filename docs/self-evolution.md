# Self-evolution notes

Code Buddy can read its own documented evolution without calling a provider or inspecting an arbitrary project. The source is the project’s `CHANGELOG.md`, parsed into dated notes containing concise facts, environment variables, commands, and activation state.

## CLI

```bash
buddy changelog --self
buddy changelog --self --since 2026-09-02 --subject voice --limit 3
buddy self evolution --json
```

Both commands use the same Markdown presenter. JSON contains `kind: "self_evolution"` and the structured notes. The cache is written only to `.codebuddy/self-model/evolution.json` in the project configuration directory; a changed source file invalidates it. A missing or unreadable cache never prevents a read-only parse.

## Lisa

Set both layers when the relational context and the self-evolution context are wanted:

```bash
CODEBUDDY_COMPANION_RELATIONAL=true \
CODEBUDDY_COMPANION_SELF_EVOLUTION=true buddy server
```

Lisa receives no more than three first-person lines such as what she learned about listening or checking an answer. They omit hashes, paths, variables, and repository vocabulary. She must not mention this context spontaneously; the intended invitation is: “qu’est-ce qui a changé chez toi ?”. The default remains silent and unchanged.

## Darwin-Gödel context

Set `CODEBUDDY_SELF_IMPROVE_EVOLUTION_SOURCE=true` to add the recent notes as `evolution-notes` experiences. Each experience explains “ce qui a été réparé et pourquoi”, and its archive entry carries `provenance: "changelog"`. The existing empirical engine still controls proposals and the reversible learning layer. This source never edits `src/`, even when a cycle runs.

The source is local and best-effort. It does not use paid APIs, network probes, services, or personal-data stores.

## Tool

The read-only `self_evolution` tool accepts `since`, `subject`, and `limit`. It is exposed to the model and dispatched in interactive chat, but it is deliberately not marked `fleetSafe`.
