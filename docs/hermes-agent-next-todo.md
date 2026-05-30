# Hermes Agent next implementation TODO

Date: 2026-05-30
Source of truth:
- `npx tsx src/index.ts hermes parity --json`
- `npx tsx src/index.ts hermes tools --json`
- Official audit: [`hermes-agent-official-parity-audit-2026-05-30.md`](hermes-agent-official-parity-audit-2026-05-30.md)

Current measured state:
- Feature parity manifest: 19 areas, 3 covered-partial, 14 partial, 2 gaps.
- Tool parity manifest: 71 official tools, 35 exact, 6 native-equivalent, 6 partial, 24 gaps.
- Important product choice: Code Buddy maps Hermes Agent onto native TypeScript/Fleet/Cowork primitives. It does not vendor the upstream Python runtime.

## P0 — Finish the core learning loop

- [ ] **Implement review-gated `skill_manage` lifecycle**
  - Why: this is the highest-value remaining Hermes core gap. Code Buddy can create/discover/install candidates, but the lifecycle still needs Cowork controls to feel complete.
  - Done so far: agent-facing `skill_manage` facade for installed `list`/`view`/`history`, direct `create`/`discover`, review-gated `enable`/`disable`/`deprecate`/`delete`/`patch`/`rollback`/`update`, and review-gated candidate `list`/`view`/`install`, backed by the real SkillsHub/create-skill/candidate primitives. Candidate installs are indexed back into both the active SkillsHub lockfile and the workspace SkillsHub lockfile with checksum so `skill_manage list/view` and candidate review can see them immediately. Patches and updates snapshot the real SKILL.md before writing, rollback restores a cached snapshot, and history exposes the current file plus rollbackable snapshots with on-disk integrity checks. `skill_manage candidate_list/view` now report whether the matching workspace skill is not installed, current, different, or missing on disk before approval, with a bounded unified diff preview when content differs.
  - Remaining scope: optionally add remote hub release diff previews.
  - Guardrail: every mutation must be review-gated or reversible; no silent skill overwrite from the agent loop.
  - Acceptance:
    - A temp workspace can create a candidate skill, inspect it, approve/install it, list the installed version, patch it, roll it back, update it from local hub cache metadata, deprecate it, re-enable it, and remove it from the installed index.
    - Remaining: add richer remote release diff previews when a hub backend is configured.
    - Installed skills keep provenance: source run/candidate, reviewer, approval time, prior version if overwritten.
    - Cowork can show the candidate vs installed skill state and diff preview before approval.
  - Verification:
    - `npm test -- tests/agent/research-script-skill-candidate.test.ts tests/commands/tools-commands.test.ts --run`
    - real CLI smoke in a temp repo using `buddy tools skill-candidate ...` plus the new manage command/tool.

- [x] **Inject accepted user-model summaries automatically per session**
  - Why: Hermes-style "model of who you are" should influence fresh sessions without manually calling `user_model_recall`.
  - Done: accepted, privacy-safe user model summaries are injected as `<user_model_context>` through the shared per-turn context pipeline, behind the default-on `USER_MODEL_INJECTION` flag. Pending/rejected observations stay out of prompts, and `buddy hermes prompt-size` now counts the injected section without printing the private content.
  - Guardrail: never inject pending/rejected observations; keep sensitive categories blocked by existing privacy filters.
  - Verification:
    - `npm test -- tests/memory/user-model.test.ts tests/agent/execution/context-pipeline-user-model.test.ts tests/commands/hermes-commands.test.ts --run`
    - real temp workspace: observe -> accept -> run `buddy hermes prompt-size --json` and confirm the user-model section is counted but content is not printed.

- [x] **Strengthen Learning Agent skill scoring**
  - Why: usage telemetry exists, but reinforcement/deprecation should become a robust promotion signal, not just displayed metadata.
  - Done: core telemetry now scores every real skill outcome, stores bounded score history, records the recommendation (`observe`/`reinforce`/`improve`/`deprecate`), keeps the reason and next action, and shows the same fields in `buddy skills learning-usage` plus Cowork's Learning skill usage strip.
  - Guardrail: scoring can recommend, but should not silently mutate installed skills.
  - Acceptance:
    - Repeated successful use increases confidence.
    - Repeated failures mark a skill as deprecated or propose an improvement candidate.
    - Cowork displays score reason, last evidence run, and next action.
  - Verification:
    - `npm test -- tests/agent/learning-agent-real.test.ts --run`
    - `(cd cowork && npm test -- tests/learning-usage-bridge.test.ts tests/learning-skill-usage-strip.test.ts --run)`

## P1 — Make the Hermes cockpit operational in Cowork

- [ ] **Build a Cowork Skill Package Manager panel**
  - Why: Cowork now shows candidates and telemetry, but it cannot fully pilot installed skills, versions, and review decisions from one place.
  - Done so far: Cowork Fleet now has an installed-skill package strip backed by the real SkillsHub lockfile. It shows installed/enabled/inactive counts, deprecated skills first, integrity state, usage counts, lifecycle reviewer/reason, rollback snapshot counts, a short current `SKILL.md` preview, and review-safe CLI commands. The strip can seed a `skill_manage ... approved_by=<reviewer>` goal and now performs reviewer-gated enable/disable/deprecate, latest-snapshot rollback, delete, cached hub update, and exact-text patch actions through the real main-process skill package bridge. `skills_list` and `buddy skills list --json` now also expose `exists`/`integrityOk` so stale lockfile entries are visible before reuse, and `buddy skills doctor --json` reports missing/tampered packages with review-gated remediation commands. The candidate queue and `skill_manage candidate_list/view` now compare each materialized `SKILL.md` candidate with the real workspace SkillsHub lockfile and show not-installed/current/different/missing states, review commands, and a bounded unified diff preview for differing installed content. Cowork can now capture a reviewer identity and install or overwrite an eligible candidate through the real main-process skill candidate bridge, then refresh the candidate queue.
  - Scope: installed skills list, candidate queue, SKILL.md preview, candidate-vs-installed diff, approve/install/enable/disable/deprecate/rollback/delete/update/patch actions.
  - Remaining scope: turn the strips into a full panel with expanded side-by-side SKILL.md diff.
  - Acceptance:
    - Operator can review a Learning Agent SKILL.md candidate and install it without leaving Cowork.
    - UI distinguishes installed, candidate, deprecated, and failed/recommended-improvement skills.
    - All write actions require explicit reviewer identity.
  - Verification:
    - `npm test -- tests/agent/hermes-skill-package-summary-real.test.ts --run`
    - `npm test -- tests/agent/research-script-skill-candidate.test.ts --run`
    - `npm test -- tests/commands/skills-command-real.test.ts --run`
    - `npm test -- tests/tools/skills-inspection-real.test.ts tests/skills/hub.test.ts --run`
    - `(cd cowork && npm test -- tests/skill-package-manager-bridge.test.ts tests/skill-package-manager-strip.test.ts tests/i18n-french-support.test.ts tests/fleet-command-center-board.test.ts --run)`
    - Playwright flow over a temp workspace with a materialized skill candidate.

- [x] **Add a Hermes toolset/catalog status surface**
  - Why: `buddy hermes tools` is now discoverable, but Cowork should also show exact/partial/gap status by category.
  - Done: Cowork Fleet now has a read-only Hermes tool catalog strip backed by the same local parity manifest as `buddy hermes tools --json`. It shows exact/native/partial/gap counts and prioritized work such as `skill_manage`, `text_to_speech`, and `video_analyze`. Kanban, `send_message`, `execute_code`, `vision_analyze`, and `browser_vision` exact tool-name gaps have since been closed in the core registry.
  - Acceptance:
    - Cowork shows summary counts and top core gaps such as `skill_manage`, `text_to_speech`, and `video_analyze`.
    - Platform-only gaps do not hide the prioritized coding-agent work because the bridge orders core priority items first.
  - Verification:
    - `npx tsx src/index.ts hermes tools --json`
    - `npm test -- tests/agent/hermes-tool-parity-local.test.ts tests/commands/hermes-commands.test.ts --run`
    - `(cd cowork && npm test -- tests/hermes-tool-catalog-bridge.test.ts tests/hermes-tool-catalog-strip.test.ts --run)`

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

- [x] **Decide and implement `execute_code` parity**
  - Why: upstream Hermes uses `execute_code` to collapse multi-step scripted work into one controlled boundary.
  - Done: Code Buddy now exposes exact `execute_code` with real local subprocess execution for JavaScript/TypeScript/Python/shell snippets. Every run writes a real artifact directory under `.codebuddy/execute-code/<run-id>` with `script.*`, `stdout.log`, `stderr.log`, `result.json`, a timeout result, and structured paths. It is deliberately grouped under runtime/dangerous policy; Docker isolation remains available through `run_script`.
  - Acceptance:
    - Agent can run a short script in a temp workspace and receive structured stdout/stderr/files touched.
    - Dangerous filesystem/network behavior follows existing permission policy.
  - Verification:
    - `npm test -- tests/tools/execute-code-real.test.ts --run`
    - `npm test -- tests/tools/execute-code-real.test.ts tests/agent/hermes-tool-parity-local.test.ts tests/commands/hermes-commands.test.ts --run`

- [x] **Add unified `vision_analyze` / `browser_vision` semantics**
  - Why: Code Buddy has screenshots/OCR/browser image inventory, but no one-shot Hermes-like vision analysis surface.
  - Done: Code Buddy now exposes exact `vision_analyze` and `browser_vision` prompt tools. `vision_analyze` inspects a real local image with `sharp`, reports dimensions/format/size/dominant color/labels, writes a durable `.codebuddy/vision-analysis/*.json` report, and can attempt local OCR. `browser_vision` opens/captures a real Playwright browser page, writes the screenshot under `.codebuddy/browser-vision`, analyzes that image, and can include accessibility snapshot context.
  - Guardrail: keep image capture local unless user/provider configuration explicitly allows remote vision.
  - Acceptance:
    - Local HTML page -> screenshot -> vision/OCR result -> assertion in test.
    - Tool parity marks `vision_analyze` and `browser_vision` exact.
  - Verification:
    - `npm test -- tests/tools/vision-analyze-real.test.ts --run`
    - `npm test -- tests/tools/vision-analyze-real.test.ts tests/agent/hermes-tool-parity-local.test.ts tests/commands/hermes-commands.test.ts --run`

- [x] **Add an exact `send_message` prompt tool over existing channel adapters**
  - Why: channels and scheduled delivery exist, but Hermes has a direct messaging tool surface.
  - Done: `send_message` is now an exact prompt tool. It dry-runs to a real `.codebuddy/messages/outbox.jsonl` artifact by default; live delivery requires `approved_by`, passes through `SendPolicyEngine`, and then uses `ChannelManager`.
  - Guardrail: never send externally without configured channel and explicit approval policy.
  - Verification:
    - `npm test -- tests/tools/send-message-real.test.ts --run`

## P3 — Decide on optional ecosystem parity

- [x] **Kanban parity decision**
  - Done: Implemented exact `kanban_show/list/create/complete/block/comment/link/unblock/heartbeat` prompt tools on top of a persistent `.codebuddy/kanban-board.json` workspace board, plus `buddy hermes kanban *` CLI commands.
  - Remaining optional UX: add a Cowork board renderer if the Kanban becomes a daily coordination surface.
  - Verification:
    - `npm test -- tests/tools/kanban-real.test.ts --run`
    - `npx tsx src/index.ts hermes kanban list --json`

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

1. Cowork Skill Package Manager panel.
2. Expose provider/model readiness for Hermes.
3. Runtime backend inventory.
4. Optional platform connectors only on demand.
