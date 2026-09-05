# Codex Autonomous Coding Notes

Date: 2026-06-28

Local source reviewed: `~/DEV/codex`.

## Codex patterns worth importing

- `codex-rs/core/templates/model_instructions/gpt-5.2-codex_instructions_template.md`
  - The coding agent posture is explicit: read first, work in the shared workspace, protect user changes, avoid destructive git commands, and verify before final handoff.
- `codex-rs/protocol/src/plan_tool.rs`
  - Plans are structured as bounded steps with `pending`, `in_progress`, and `completed` states.
- `codex-rs/protocol/src/request_permissions.rs`
  - Elevated permissions are modeled as explicit requests with a reason and a scope, not hidden side effects.
- `codex-rs/core/src/context/environment_context.rs`
  - Runtime context is rendered as bounded machine-readable fragments: cwd, shell, workspace roots, filesystem profile, network status.
- `codex-rs/apply-patch/tests/suite/*.rs`
  - Editing is treated as a narrowly validated operation with predictable failure behavior.

## Applied in Code Buddy

- Added `src/agent/autonomous/codex-autonomy-directive.ts`.
- Injected that directive into:
  - `renderAgenticCodingEditProposalPrompt`
  - `buildAgenticCodingEditProposalProducerDispatch`
  - `runVerificationAndSelfCorrectionLoop` follow-up prompts
- The directive does not grant extra authority. It keeps the current Agentic Coding Cell guardrails:
  - contract validation
  - allowed paths
  - dirty-worktree preflight
  - controlled edit proposals
  - preview / approval / apply
  - declared verification
- It improves the autonomous coding behavior expected from a producer agent:
  - investigate before editing
  - maintain an explicit plan
  - protect user work
  - propose exact bounded edits
  - validate before handoff
  - report blockers honestly

## Next candidates

- Add a runner-owned progress event for each Codex-style phase so Cowork can display plan progress even before edits exist.
- Add a strict "final handoff completeness" checker that requires changed files, verification result, residual risks, and blocked items.
- Add a compact post-run evaluator that checks whether the final answer includes files changed, verification, residual risks, and blocked items.
