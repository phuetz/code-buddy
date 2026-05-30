# Hermes Agent next implementation TODO

Date: 2026-05-30
Source of truth:
- `npx tsx src/index.ts hermes parity --json`
- `npx tsx src/index.ts hermes tools --json`
- Official audit: [`hermes-agent-official-parity-audit-2026-05-30.md`](hermes-agent-official-parity-audit-2026-05-30.md)

Current measured state:
- Feature parity manifest: 19 areas, 2 covered-partial, 14 partial, 3 gaps.
- Tool parity manifest: 71 official tools, 22 exact, 6 native-equivalent, 10 partial, 33 gaps.
- Important product choice: Code Buddy maps Hermes Agent onto native TypeScript/Fleet/Cowork primitives. It does not vendor the upstream Python runtime.

## P0 — Finish the core learning loop

- [ ] **Implement review-gated `skill_manage` lifecycle**
  - Why: this is the highest-value remaining Hermes core gap. Code Buddy can create/discover/install candidates, but not manage edit/patch/delete/rollback as one coherent lifecycle.
  - Done so far: agent-facing `skill_manage` facade for installed `list`/`view`, direct `create`/`discover`, and review-gated candidate `list`/`view`/`install`, backed by the real SkillsHub/create-skill/candidate primitives.
  - Remaining scope: add review-gated update/patch/deprecate/delete/rollback operations as one coherent lifecycle.
  - Guardrail: every mutation must be review-gated or reversible; no silent skill overwrite from the agent loop.
  - Acceptance:
    - A temp workspace can create a candidate skill, inspect it, patch it, approve/install it, list the installed version, deprecate it, and rollback/remove it.
    - Installed skills keep provenance: source run/candidate, reviewer, approval time, prior version if overwritten.
    - Cowork can show the candidate vs installed skill diff before approval.
  - Verification:
    - `npm test -- tests/agent/research-script-skill-candidate.test.ts tests/commands/tools-commands.test.ts --run`
    - real CLI smoke in a temp repo using `buddy tools skill-candidate ...` plus the new manage command/tool.

- [ ] **Inject accepted user-model summaries automatically per session**
  - Why: the local user model exists, but Hermes-style "model of who you are" is still on-demand through `user_model_recall`.
  - Scope: inject accepted, privacy-safe user model summary into the per-turn context budget with a setting to disable it.
  - Guardrail: never inject pending/rejected observations; keep sensitive categories blocked by existing privacy filters.
  - Acceptance:
    - Accepted observations influence a fresh session without manually calling `user_model_recall`.
    - Pending observations stay out of prompts.
    - Prompt-size diagnostics account for the injected user-model section.
  - Verification:
    - `npm test -- tests/memory/user-model.test.ts tests/agent/*prompt* --run`
    - real temp workspace: observe -> accept -> start session/export prompt context.

- [ ] **Strengthen Learning Agent skill scoring**
  - Why: usage telemetry exists, but reinforcement/deprecation should become a robust promotion signal, not just displayed metadata.
  - Scope: define thresholds for reinforce/deprecate/improve, store score history, and show why a skill changed state.
  - Guardrail: scoring can recommend, but should not silently mutate installed skills.
  - Acceptance:
    - Repeated successful use increases confidence.
    - Repeated failures mark a skill as deprecated or propose an improvement candidate.
    - Cowork displays score reason, last evidence run, and next action.
  - Verification:
    - `npm test -- tests/agent/learning-agent-real.test.ts cowork/tests/learning-skill-usage-strip.test.ts --run`

## P1 — Make the Hermes cockpit operational in Cowork

- [ ] **Build a Cowork Skill Package Manager panel**
  - Why: Cowork now shows candidates and telemetry, but it cannot fully pilot installed skills, versions, and review decisions from one place.
  - Scope: installed skills list, candidate queue, SKILL.md preview, candidate-vs-installed diff, approve/install/disable/deprecate actions.
  - Acceptance:
    - Operator can review a Learning Agent SKILL.md candidate and install it without leaving Cowork.
    - UI distinguishes installed, candidate, deprecated, and failed/recommended-improvement skills.
    - All write actions require explicit reviewer identity.
  - Verification:
    - targeted Vitest for bridge + renderer strip/panel
    - Playwright flow over a temp workspace with a materialized skill candidate.

- [ ] **Add a Hermes toolset/catalog status surface**
  - Why: `buddy hermes tools` is now discoverable, but Cowork should also show exact/partial/gap status by category.
  - Scope: compact Fleet/Hermes panel using the existing tool parity manifest.
  - Acceptance:
    - Cowork shows summary counts and top core gaps: `skill_manage`, `execute_code`, `vision_analyze`, `browser_vision`, `kanban_*`.
    - Platform-only gaps are grouped separately so they do not distract from coding-agent work.
  - Verification:
    - `npx tsx src/index.ts hermes tools --json`
    - Cowork renderer tests for the panel.

- [ ] **Expose provider/model readiness for Hermes**
  - Why: the provider stack is broad, but Hermes-oriented setup/status is still scattered.
  - Scope: `buddy hermes doctor` should show provider readiness, active model, context window, tool support, and missing keys without leaking secrets.
  - Acceptance:
    - `buddy hermes doctor --json` includes provider readiness and remediation hints.
    - Cowork configuration screen can render the same status.
  - Verification:
    - tests around `hermes-agent-diagnostics`
    - real CLI smoke with empty and configured env.

## P2 — Close high-value tool partials

- [ ] **Decide and implement or reject `execute_code` parity**
  - Why: upstream Hermes uses `execute_code` to collapse multi-step scripted work into one controlled boundary.
  - Scope: product/security decision first. If implemented, make it sandboxed, logged, timeout-bounded, and reviewable.
  - Acceptance if implemented:
    - Agent can run a short script in a temp workspace and receive structured stdout/stderr/files touched.
    - Dangerous filesystem/network behavior follows existing permission policy.
  - Acceptance if rejected:
    - Parity manifest marks it intentionally out of scope with rationale.
  - Verification:
    - real temp repo script run; no mocks only.

- [ ] **Add unified `vision_analyze` / `browser_vision` semantics**
  - Why: Code Buddy has screenshots/OCR/browser image inventory, but no one-shot Hermes-like vision analysis surface.
  - Scope: expose a tool that can analyze a local image, screenshot, or active browser viewport and return structured observations.
  - Guardrail: keep image capture local unless user/provider configuration explicitly allows remote vision.
  - Acceptance:
    - Local HTML page -> screenshot -> vision/OCR result -> assertion in test.
    - Tool parity marks `vision_analyze` and/or `browser_vision` at least native-equivalent.
  - Verification:
    - Playwright local page test, no network dependency.

- [ ] **Add an exact `send_message` prompt tool over existing channel adapters**
  - Why: channels and scheduled delivery exist, but Hermes has a direct messaging tool surface.
  - Scope: wrap existing channel adapters with dry-run/preview-by-default and explicit delivery confirmation.
  - Guardrail: never send externally without configured channel and explicit approval policy.
  - Acceptance:
    - `send_message` can dry-run to a local/null channel and produce a delivery artifact.
    - Real send remains permission-gated.
  - Verification:
    - local/null channel integration test.

## P3 — Decide on optional ecosystem parity

- [ ] **Kanban parity decision**
  - Options:
    - Implement official `kanban_show/list/create/complete/block/comment/link/unblock/heartbeat` tools.
    - Or map them explicitly to native Fleet/Spec queues and mark as native-equivalent.
  - Recommendation: map to native Fleet/Spec first; implement exact names only if a Hermes import/export workflow needs them.

- [ ] **Runtime backend inventory**
  - Scope: detect/configure local, Docker, SSH, WSL, sandbox, Vercel Sandbox/Modal/Daytona if product-relevant.
  - Acceptance: `buddy hermes doctor --json` reports available backends and smoke commands.

- [ ] **Platform connectors**
  - Lower priority unless the user explicitly needs them:
    - Home Assistant: `ha_*`
    - Spotify: `spotify_*`
    - Feishu drive comments
    - Yuanbao group/DM/stickers
    - Discord admin
    - `x_search`
    - `image_generate` / `video_generate`
  - Recommendation: keep these as optional connectors/plugins, not core Code Buddy agent work.

## Immediate next implementation order

1. `skill_manage` review-gated lifecycle.
2. Cowork Skill Package Manager panel.
3. Automatic accepted user-model injection.
4. Hermes toolset/catalog status in Cowork.
5. `execute_code` security/product decision.
6. Unified `vision_analyze` / `browser_vision`.
7. `send_message` wrapper over existing channels.
8. Kanban mapping decision.
9. Runtime backend inventory.
10. Optional platform connectors only on demand.
