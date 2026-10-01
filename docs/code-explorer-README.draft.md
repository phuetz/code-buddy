<!--
  DRAFT — simple landing-page README for github.com/phuetz/code-explorer
  Staged here (my lane) because Codex is active on the `typescript` branch.
  When ready: in the code-explorer repo, move the current 39K README.md to
  docs/REFERENCE.md (keep the detail), then drop this in as the new README.md.
  A French twin can live in README.fr.md.
-->

# Code Explorer

**Graph-powered code intelligence for AI agents.** Written in Rust.

Code Explorer reads your whole repository **once** and turns it into a queryable
**knowledge graph** — every function, class, call, and import. It then exposes
that graph to any AI coding agent over [MCP](https://modelcontextprotocol.io/),
so the agent can ask *"who calls this?"* or *"what breaks if I change it?"* and
get a precise answer in milliseconds — instead of reading file after file.

---

## The problem it solves

AI coding assistants (Claude Code, Cursor, Copilot…) read source files **one at
a time, on demand**. On a large codebase that means:

- reading dozens of files to follow a single call chain,
- starting from scratch every conversation,
- filling the context window with raw code, leaving no room to actually reason.

Worst of all, **a text search can't compute a transitive blast radius.** `grep`
finds where a name *appears*; it can't tell you the chain of things that break
three hops away.

## What it brings

Code Explorer pre-computes all of that, once, into a graph that lives on disk
and answers structural questions instantly:

| You ask… | Tool |
|---|---|
| Where is this defined? Who calls it, what does it call? | `context` |
| **What breaks if I change X?** (full blast radius) | `impact` |
| Any circular dependencies / dead code / complexity hotspots? | `find_cycles` / `coverage` / `get_complexity` |
| How risky is my current diff? | `detect_changes` |
| Anything else | `cypher` (read-only graph query) |

**Tools over MCP · 14 languages · 100% local, no internet required.** (The public build exposes a tool interface; the `business` tool lives in a private edition.) Works
with any MCP-compatible agent (Claude Code, Cursor, VS Code…).

## The gain, measured

Real numbers from indexing a 1,864-file TypeScript codebase (Code Buddy itself):

> **Index:** 1,864 files → **63,719 nodes / 146,120 edges**, built once.

Question: *"What breaks if I change `executePlan`?"*

| | Agent alone (grep + read) | Agent + Code Explorer |
|---|---|---|
| Method | grep finds **3 files** that mention the name | one `impact` call |
| Cost | reading them ≈ **24,000 tokens** (estimate) | **0.6 s** per call |
| Answer | direct mentions only — the transitive blast radius is **uncomputable** by text search | **187 affected symbols** (82 downstream + 105 upstream), 5 levels deep |

The point isn't only token savings. It's **capability**: the complete transitive
impact is something a text-search agent simply can't produce reliably — it gives
up after a few hops or guesses. The graph returns it in one call.

<sub>The `3 files`, `0.6 s` and `187 symbols` figures are measured directly
(`grep -rl`, `time gitnexus impact`, `impact … --direction both`). The token
*comparison* is an order-of-magnitude estimate — rigorous A/B token/latency
numbers come from a reproducible with-vs-without-graph benchmark harness.</sub>

## Quick start

```bash
# 1. Build (release, ~35 MB binary)
cargo build --release        # binary at target/release/gitnexus

# 2. Index your repo once (re-run with --incremental after changes)
gitnexus analyze .

# 3. Point your agent at it over MCP
gitnexus mcp-install         # writes .mcp.json for Claude Code
# …or add it manually:  { "command": "gitnexus", "args": ["mcp"] }
```

Verify the connection and inspect the reported tool names with `buddy mcp test code-explorer`.

## Honest caveats

- Every tool is **read-only analysis** except `rename`, which defaults to a dry run.
- **Static analysis:** call edges that flow through **dynamic imports**
  (`await import(...)`, reflection) may be missing — so `impact` can under-report
  and "no callers / dead code" is a *candidate*, not proof. Treat the graph as a
  fast, precise navigation aid, not an exhaustive call graph.
- The graph is a snapshot. After large structural changes, re-index
  (`gitnexus analyze . --incremental`).

## License

**[PolyForm Noncommercial 1.0.0](LICENSE).** Free to use, study, test, and build
on for any **non-commercial** purpose — personal projects, research, education,
evaluation. **Commercial use requires a separate license** — open an issue or get
in touch.

<sub>Detailed reference (the tool interfaces, every language, legacy .NET support, the
HTML doc generator and desktop app) lives in [docs/REFERENCE.md](docs/REFERENCE.md).</sub>
