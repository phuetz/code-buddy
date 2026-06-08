# Hermes Agent next implementation TODO

Date: 2026-05-30
Source of truth:
- `npx tsx src/index.ts hermes parity --json`
- `npx tsx src/index.ts hermes todo --json`
- `npx tsx src/index.ts hermes tools --json`
- `npx tsx src/index.ts hermes portal status --json`
- Official audit: [`hermes-agent-official-parity-audit-2026-05-30.md`](hermes-agent-official-parity-audit-2026-05-30.md)

Current measured state:
- Feature parity manifest: 20 areas, **0 remaining gaps** — OpenClaw migration is
  now implemented via `buddy hermes claw migrate` (status `partial`: identity/memory/
  default-model/MCP/skills imported, remaining categories archived for review;
  fixture-tested, no real OpenClaw install validated). See `buddy hermes parity --json`
  for the live covered/partial split.
- Compact active TODO: `buddy hermes todo --json` derives the next feature
  work from the same manifest and keeps the deferred OpenClaw migration out of
  active work unless `--include-deferred` is passed.
- Tool parity manifest: 71 official tools, 65 exact, 6 native-equivalent, 0 partial, 0 gaps.
- Important product choice: Code Buddy maps Hermes Agent onto native TypeScript/Fleet/Cowork primitives. It does not vendor the upstream Python runtime.

## P0 — Finish the core learning loop

- [x] **Implement review-gated `skill_manage` lifecycle**
  - Why: this was the highest-value remaining Hermes core tool gap. Hermes' agent-managed procedural memory depends on exact `skill_manage` create/edit/patch/delete/supporting-file actions.
  - Done: agent-facing `skill_manage` facade for installed `list`/`view`/`history`, direct `create`/`discover`, official `create(content)` / `edit(content)` / `patch(old_string,new_string,file_path,replace_all)` / `write_file` / `remove_file` aliases, review-gated `enable`/`disable`/`deprecate`/`delete`/`patch`/`rollback`/`reset`/`update`, and review-gated candidate `list`/`view`/`install`, backed by the real SkillsHub/create-skill/candidate primitives. Candidate installs are indexed back into both the active SkillsHub lockfile and the workspace SkillsHub lockfile with checksum so `skill_manage list/view` and candidate review can see them immediately. Edits, patches, supporting-file mutations, resets, and updates snapshot the real SKILL.md before writing, rollback restores a cached snapshot, reset restores canonical hub/cache content after reviewer approval, and history exposes the current file plus rollbackable snapshots with on-disk integrity checks. `skill_manage candidate_list/view` now report whether the matching workspace skill is not installed, current, different, or missing on disk before approval, with a bounded unified diff preview when content differs. `SkillsHub` now also persists Hermes-style repository taps with path and trust metadata, `buddy skills tap list/add/remove/trust` exposes the real tap registry for reviewer-managed third-party skill sources, `buddy skills tap refresh` plus `buddy skills well-known <url>` populate a persistent discovery cache from real GitHub Contents API or `.well-known/skills/index.json` HTTP paths, and `buddy skills update-preview` / `skill_manage action=preview_update` show a bounded remote update diff before any approved update writes to disk.
  - Remaining scope: optional dedicated Cowork full-page manager route if the Fleet cockpit strips need more room.
  - Guardrail: every mutation must be review-gated or reversible; no silent skill overwrite from the agent loop.
  - Acceptance:
    - A temp workspace can create a candidate skill, inspect it, approve/install it, list the installed version, patch it, roll it back, update it from local hub cache metadata, deprecate it, re-enable it, and remove it from the installed index.
    - `buddy skills reset <name> --approved-by <reviewer>` and `skill_manage action=reset` restore tampered or missing installed `SKILL.md` files from the real hub/cache path only after reviewer approval.
    - Installed skills keep provenance: source run/candidate, reviewer, approval time, prior version if overwritten.
    - Cowork can show the candidate vs installed skill state and diff preview before approval.
  - Verification:
    - `npm test -- tests/tools/skills-inspection-real.test.ts tests/unit/agent-tool-definitions-activation.test.ts --run`
    - `npm test -- tests/skills/hub.test.ts tests/commands/skills-command-real.test.ts --run`
    - `npm test -- tests/tools/cronjob-tool-real.test.ts tests/tools/session-search-real.test.ts tests/tools/skills-inspection-real.test.ts tests/commands/skills-command-real.test.ts tests/agent/hermes-skill-package-summary-real.test.ts --run`
    - `(cd cowork && npm test -- tests/test-runner-bridge-catalog.test.ts --run)` confirms the safe Cowork Test Runner persistence/skills smoke entry.
    - `npx tsx src/index.ts hermes tools --json`

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
    - `npm test -- tests/agent/learning-agent-real.test.ts tests/commands/learning-retrospective-command.test.ts --run`
    - `npx tsx src/index.ts hermes learning status --json`
    - `(cd cowork && npm test -- tests/test-runner-bridge-catalog.test.ts --run)` confirms the safe Cowork Test Runner smoke entry.
    - `(cd cowork && npm test -- tests/learning-usage-bridge.test.ts tests/learning-skill-usage-strip.test.ts --run)`

## P1 — Make the Hermes cockpit operational in Cowork

- [x] **Build a Cowork Skill Package Manager review panel**
  - Why: Cowork now shows candidates and telemetry, but it cannot fully pilot installed skills, versions, and review decisions from one place.
  - Done: Cowork Fleet now has an installed-skill package strip backed by the real SkillsHub lockfile. It shows installed/enabled/inactive counts, deprecated skills first, integrity state, usage counts, lifecycle reviewer/reason, rollback snapshot counts, a short current `SKILL.md` preview, and review-safe CLI commands. The strip can seed a `skill_manage ... approved_by=<reviewer>` goal and now performs reviewer-gated enable/disable/deprecate, latest-snapshot rollback, delete, cached hub update, and exact-text patch actions through the real main-process skill package bridge. `skills_list` and `buddy skills list --json` now also expose `exists`/`integrityOk` so stale lockfile entries are visible before reuse, and `buddy skills doctor --json` reports missing/tampered packages with review-gated remediation commands. The candidate queue and `skill_manage candidate_list/view` now compare each materialized `SKILL.md` candidate with the real workspace SkillsHub lockfile and show not-installed/current/different/missing states, review commands, a bounded unified diff preview, and an expandable side-by-side installed-vs-candidate `SKILL.md` diff before overwrite. Cowork can capture a reviewer identity and install or overwrite an eligible candidate through the real main-process skill candidate bridge, then refresh the candidate queue.
  - Scope: installed skills list, candidate queue, SKILL.md preview, candidate-vs-installed diff, approve/install/enable/disable/deprecate/rollback/delete/update/patch actions.
  - Remaining scope: optional dedicated full-page manager route if daily usage demands more room than the Fleet cockpit strips.
  - Acceptance:
    - Operator can review a Learning Agent SKILL.md candidate and install it without leaving Cowork.
    - UI distinguishes installed, candidate, deprecated, and failed/recommended-improvement skills.
    - All write actions require explicit reviewer identity.
  - Verification:
    - `npm test -- tests/agent/hermes-skill-package-summary-real.test.ts --run`
    - `npm test -- tests/agent/research-script-skill-candidate.test.ts --run`
    - `npm test -- tests/commands/skills-command-real.test.ts --run`
    - `npm test -- tests/tools/skills-inspection-real.test.ts tests/skills/hub.test.ts --run`
    - `npm test -- tests/tools/cronjob-tool-real.test.ts tests/tools/session-search-real.test.ts tests/tools/skills-inspection-real.test.ts tests/commands/skills-command-real.test.ts tests/agent/hermes-skill-package-summary-real.test.ts --run`
    - `(cd cowork && npm test -- tests/skill-package-manager-bridge.test.ts tests/skill-package-manager-strip.test.ts tests/skill-candidate-review-queue-strip.test.ts tests/i18n-french-support.test.ts tests/fleet-command-center-board.test.ts --run)`
    - Playwright flow over a temp workspace with a materialized skill candidate.

- [x] **Add a Hermes toolset/catalog status surface**
  - Why: `buddy hermes tools` is now discoverable, but Cowork should also show exact/partial/gap status by category.
  - Done: Cowork Fleet now has a read-only Hermes tool catalog strip backed by the same local parity manifest as `buddy hermes tools --json`. It shows exact/native/partial/gap counts. `buddy hermes toolsets [profile] --json` now exposes the native Fleet/Hermes toolset catalog directly, with all five `fleet.hermes.*` profiles, policy group boundaries, active toolset, and representative allow/confirm/deny decisions without requiring the wider doctor payload. Kanban, `send_message`, `discord`, `discord_admin`, Home Assistant `ha_*`, Feishu document/comment tools, Yuanbao group/DM/sticker tools, `skill_manage`, `mixture_of_agents`, `execute_code`, `vision_analyze`, `browser_vision`, `text_to_speech`, `image_generate`, `video_analyze`, and `video_generate` exact tool-name gaps have since been closed in the core registry.
  - Acceptance:
    - Cowork shows summary counts and top partial/gap items if any reappear.
    - Platform-only tools remain optional and do not hide the prioritized coding-agent work.
  - Verification:
    - `npx tsx src/index.ts hermes tools --json`
    - `npx tsx src/index.ts hermes toolsets safe --json`
    - `npm test -- tests/agent/hermes-cli-status-real.test.ts --run`
    - `npm test -- tests/tools/text-to-speech-real.test.ts tests/tools/vision-analyze-real.test.ts tests/tools/media-generation-real.test.ts --run`
    - `npm test -- tests/agent/hermes-tool-parity-local.test.ts tests/commands/hermes-commands.test.ts --run`
    - `(cd cowork && npm test -- tests/test-runner-bridge-catalog.test.ts --run)`
    - `(cd cowork && npm test -- tests/hermes-tool-catalog-bridge.test.ts tests/hermes-tool-catalog-strip.test.ts --run)`

- [x] **Add one-command Hermes readiness and local smoke surfaces**
  - Why: Hermes evidence was available, but operators had to stitch together `todo`, `tools`, `providers`, `runtime`, `browser`, `protocols`, `memory`, `learning`, and `skills` commands by hand.
  - Done: `buddy hermes status [profile]` now aggregates feature parity, tool parity, identity, provider/model readiness, runtime route, browser route, protocol gateways, memory providers, Learning Agent review queues, skill-package health, next active Hermes work, and the exact follow-up commands. `buddy hermes smoke --json` runs the safe local-first smoke suite in one command: auto runtime, auto browser, and local MCP/A2A/ACP protocol gateways. Cowork Fleet exposes the same local proof as the "Hermes local smoke" strip through `tools.hermesLocalSmoke.run`, showing counts/status only. The JSON and UI output intentionally keep credential source names only and avoid raw trace paths, credential values, or account details.
  - Verification:
    - `npx tsx src/index.ts hermes status safe --json`
    - `npx tsx src/index.ts hermes status safe`
    - `npx tsx src/index.ts hermes smoke --json`
    - `npx tsx src/index.ts hermes smoke`
    - `npm test -- tests/commands/hermes-commands.test.ts --run`
    - `npm run typecheck`
    - `npx tsx src/index.ts hermes runtime-smoke auto --json`
    - `npx tsx src/index.ts hermes browser-smoke auto --json`
    - `cd cowork && npm test -- --run tests/hermes-local-smoke-bridge.test.ts tests/hermes-local-smoke-strip.test.ts tests/fleet-command-center-board.test.ts`

- [ ] **Expose provider/model readiness for Hermes**
  - Why: the provider stack is broad, but Hermes-oriented setup/status is still scattered.
  - Scope: `buddy hermes doctor` should show provider readiness, active model, context window, tool support, and missing keys without leaking secrets.
  - Done so far: `buddy hermes providers status --json`, `buddy hermes doctor --json`, and the aggregate `buddy hermes status --json` now include active model source, inferred provider, detected env/OAuth credential source names, model tool-call/reasoning/vision capabilities, context/output limits, remediation hints, and embedded Nous Portal readiness. Cowork renders the same status in Settings -> API and the Fleet Command Center through `tools.hermesProviderReadiness.get`. `buddy hermes portal status|tools|open` covers the official Nous Portal status/catalog surface locally with subscription/docs URLs, Tool Gateway configuration, and managed-vs-direct routing for Firecrawl/FAL/TTS/Browser Use/Modal without leaking secret values.
  - Memory update: `buddy hermes memory status --json` now exposes the official memory-provider matrix for local, Honcho, OpenViking, Mem0, Hindsight, Holographic, RetainDB, ByteRover, and Supermemory. Cowork Fleet renders the same readiness through `tools.hermesMemoryProviders.get`, including active provider, credential source names only, local fallback adapters, and missing official adapters.
  - Acceptance:
    - `buddy hermes providers status --json` and `buddy hermes doctor --json` include provider readiness and remediation hints. **Done for CLI JSON.**
    - `buddy hermes portal status --json` shows whether Nous Tool Gateway routing is configured and which tools fall back to direct/local providers.
    - Cowork configuration screen can render the same status. **Done in Settings -> API and Fleet Command Center.**
  - Remaining scope: exact upstream provider setup wizard parity and live Nous Portal OAuth/proxying remain product decisions.
  - Verification:
    - `npm test -- tests/agent/hermes-agent-diagnostics.test.ts tests/commands/hermes-commands.test.ts --run`
    - `cd cowork && npm test -- --run tests/hermes-provider-readiness-bridge.test.ts tests/hermes-provider-readiness-bridge-real.test.ts tests/hermes-provider-readiness-strip.test.ts`
    - real CLI smoke with empty and configured env.
    - `npx tsx src/index.ts hermes providers status --json`
    - `npx tsx src/index.ts hermes doctor balanced --json`
    - `npx tsx src/index.ts hermes runtime status --json`
    - `npx tsx src/index.ts hermes runtime-smoke local --json`
    - `npx tsx src/index.ts hermes portal status --json`
    - `npx tsx src/index.ts hermes portal tools --json`
    - `npx tsx src/index.ts hermes memory status --json`
    - `npm test -- tests/agent/hermes-memory-providers.test.ts tests/memory/memory-provider.test.ts --run`
    - `cd cowork && npm test -- --run tests/hermes-memory-providers-bridge.test.ts tests/hermes-memory-providers-bridge-real.test.ts tests/hermes-memory-providers-strip.test.ts`

- [x] **Expose mobile supervision readiness for Hermes**
  - Why: mobile supervision existed across `buddy run mobile-*` commands and server routes, but there was no Hermes cockpit command that told an operator whether the route mount, auth policy, approval queue, and blocked operations were ready.
  - Done: `buddy hermes mobile status [query...] --json` now builds the real mobile supervision contract, listener shell, pairing preview metadata, and approval queue without starting a listener or printing pairing codes. It reports the implemented `/api/mobile` route mount, read-only/draft-only endpoint counts, local-operator approval gates, remote-execution-disabled safety, and copy/paste `buddy run mobile-*` commands. Cowork Fleet Command Center renders the same status through `tools.hermesMobileSupervision.get`.
  - Guardrail: the status command never dispatches work, never starts a server, and never exposes pairing secret material; mobile follow-up remains draft-only until a local operator reviews it.
  - Verification:
    - `npm test -- tests/commands/hermes-commands.test.ts tests/agent/hermes-cli-status-real.test.ts --run`
    - `cd cowork && npm test -- --run tests/hermes-mobile-supervision-bridge.test.ts tests/hermes-mobile-supervision-bridge-real.test.ts tests/hermes-mobile-supervision-strip.test.ts tests/fleet-command-center-board.test.ts tests/i18n-french-support.test.ts`
    - `cd cowork && npm run typecheck && npm run build:e2e`
    - `npx tsx src/index.ts hermes mobile status "mobile supervision" --json`
    - `node dist/index.js hermes mobile status "mobile supervision" --json`

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
    - `(cd cowork && npm test -- tests/test-runner-bridge-catalog.test.ts --run)` confirms the safe Cowork Test Runner smoke entry.

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
    - `npm test -- tests/tools/browser-console-real.test.ts tests/tools/browser-dialog-real.test.ts tests/tools/browser-get-images-real.test.ts tests/tools/browser-hermes-actions-real.test.ts tests/tools/browser-snapshot-real.test.ts --run`
    - `(cd cowork && npm test -- tests/test-runner-bridge-catalog.test.ts --run)` confirms the safe Cowork Test Runner browser smoke entry.

- [x] **Add exact `text_to_speech` prompt tool**
  - Why: Code Buddy had voice/TTS managers, but Hermes exposes a direct `text_to_speech` tool that writes audio and returns a media path.
  - Done: Code Buddy now exposes exact `text_to_speech`. It writes a real local speech audio file under `.codebuddy/tts` by default, returns `MEDIA:<path>`, supports output paths, and uses detected/configured providers: Windows SAPI (`system`), macOS `say`, `edge-tts`, `espeak`, Kokoro, or AudioReader.
  - Guardrail: providers that need network, models, or local services remain explicit; `auto` only picks immediately available local providers.
  - Acceptance:
    - Real provider available -> generated audio file exists, is non-empty, and has a valid audio header.
    - Tool parity marks `text_to_speech` exact.
  - Verification:
    - `npm test -- tests/tools/text-to-speech-real.test.ts --run`

- [x] **Add exact Discord core prompt tool**
  - Why: upstream Hermes exposes a `discord` tool for core Discord REST participation; having only channel adapters was not exact parity.
  - Done: Code Buddy now exposes exact `discord` with `fetch_messages`, `search_members`, and `create_thread`, backed by Discord REST API calls and token-based auth.
  - Guardrail: the tool never accepts a token in model input; it uses configured environment/options only. Server-management actions remain separate under `discord_admin`.
  - Verification:
    - `npm test -- tests/tools/discord-tool-real.test.ts --run`

- [x] **Add exact Discord admin prompt tool**
  - Why: upstream Hermes exposes `discord_admin` separately for server-management actions, and this was a remaining official tool gap.
  - Done: Code Buddy now exposes exact `discord_admin` with `list_guilds`, `server_info`, `list_channels`, `channel_info`, `list_roles`, `member_info`, `list_pins`, `pin_message`, `unpin_message`, `delete_message`, `add_role`, and `remove_role`, all backed by Discord REST API paths.
  - Guardrail: tokens stay in env/options only; mutating admin actions require `approved_by` unless an operator explicitly enables `CODEBUDDY_DISCORD_ADMIN_ALLOW_MUTATIONS=true`.
  - Verification:
    - `npm test -- tests/tools/discord-tool-real.test.ts tests/agent/hermes-tool-parity-local.test.ts tests/commands/hermes-commands.test.ts --run`
    - `npm run typecheck`
    - `npx tsx src/index.ts hermes tools --json`

- [x] **Add exact Home Assistant prompt tools**
  - Why: upstream Hermes exposes `ha_list_entities`, `ha_get_state`, `ha_list_services`, and `ha_call_service` for smart-home control.
  - Done: Code Buddy now exposes all four exact `ha_*` tools over the Home Assistant REST API. They resolve `HASS_URL`/`HASS_TOKEN`, validate `entity_id` and service names, compact entity/service output, and block dangerous service domains before any network call.
  - Guardrail: `ha_call_service` stays in the dangerous policy group; shell/command/script/rest service domains remain blocked.
  - Verification:
    - `npm test -- tests/tools/homeassistant-tool-real.test.ts --run`

- [x] **Add exact `mixture_of_agents` prompt tool**
  - Why: upstream Hermes treats MoA as a central high-reasoning surface, not an optional platform connector.
  - Done: Code Buddy now exposes exact `mixture_of_agents` over an OpenRouter-compatible chat completions endpoint. It runs configured reference models in parallel, continues if enough references succeed, then asks a configured aggregator model to synthesize the final answer.
  - Guardrail: the tool never accepts API keys in model input; it uses configured env/options only. Tests use a real local HTTP server and production request path rather than mocked fetch.
  - Verification:
    - `npm test -- tests/tools/mixture-of-agents-real.test.ts --run`

- [x] **Add exact Spotify prompt tools**
  - Why: upstream Hermes exposes Spotify as a 7-tool native toolset, and this was the largest remaining exact-name platform gap.
  - Done: Code Buddy now exposes `spotify_playback`, `spotify_devices`, `spotify_queue`, `spotify_search`, `spotify_playlists`, `spotify_albums`, and `spotify_library` over the Spotify Web API. Tokens are read from env/options only, never from model input.
  - Guardrail: mutating playback, queue, playlist, and library actions are policy-grouped as dangerous external actions; tests use a real local HTTP server and production request construction rather than mocked fetch.
  - Verification:
    - `npm test -- tests/tools/spotify-tool-real.test.ts --run`

- [x] **Add exact `x_search` prompt tool**
  - Why: upstream Hermes exposes X Search through xAI's Responses API tool, distinct from general web search.
  - Done: Code Buddy now exposes exact `x_search` with xAI/Grok credentials from env/options, handle filters, date validation, citation extraction, retry-on-transient errors, and degraded-result signaling when filters return no citations.
  - Guardrail: credentials are never accepted in model input. Tests use a real local HTTP server and the production `/responses` request shape rather than mocked fetch.
  - Verification:
    - `npm test -- tests/tools/x-search-tool-real.test.ts --run`
    - `npm test -- tests/tools/discord-tool-real.test.ts tests/tools/homeassistant-tool-real.test.ts tests/tools/mixture-of-agents-real.test.ts tests/tools/spotify-tool-real.test.ts tests/tools/feishu-tool-real.test.ts tests/tools/yuanbao-tool-real.test.ts tests/tools/x-search-tool-real.test.ts --run`
    - `(cd cowork && npm test -- tests/test-runner-bridge-catalog.test.ts --run)` confirms the safe Cowork Test Runner platform-connector smoke entry.

- [x] **Add exact Feishu document/comment prompt tools**
  - Why: upstream Hermes exposes a Feishu/Lark document reader plus four drive comment tools, scoped to intelligent document-comment workflows.
  - Done: Code Buddy now exposes `feishu_doc_read`, `feishu_drive_list_comments`, `feishu_drive_list_comment_replies`, `feishu_drive_reply_comment`, and `feishu_drive_add_comment` over Feishu/Lark Open API REST paths. Credentials come from env/options only: direct tenant/access token or app id/secret tenant-token exchange.
  - Guardrail: comment writes are policy-grouped as dangerous external actions. Tests use a real local HTTP server and production request construction rather than mocked fetch.
  - Verification:
    - `npm test -- tests/tools/feishu-tool-real.test.ts --run`

- [x] **Add exact media generation and video analysis prompt tools**
  - Why: upstream Hermes exposes `image_generate`, `video_analyze`, and `video_generate` as agent-facing media tools.
  - Done: Code Buddy now exposes exact `image_generate`, `video_analyze`, and `video_generate` schemas. Image generation uses configured OpenAI/xAI-compatible image endpoints; video generation uses configured xAI or FAL-compatible HTTP paths; video analysis normalizes local/remote videos into video-capable model payloads. Returned image/video assets are cached under `.codebuddy/media-generation/` when providers return b64 or downloadable URLs.
  - Guardrail: provider credentials stay in env/config; generated media writes are local files; video analysis enforces format and 50 MB base64 caps.
  - Verification:
    - `npm test -- tests/tools/media-generation-real.test.ts tests/agent/hermes-tool-parity-local.test.ts tests/commands/hermes-commands.test.ts --run`
    - `npm run typecheck`
    - `npx tsx src/index.ts hermes tools --json`

- [x] **Add an exact `send_message` prompt tool over existing channel adapters**
  - Why: channels and scheduled delivery exist, but Hermes has a direct messaging tool surface.
  - Done: `send_message` is now an exact prompt tool. It dry-runs to a real `.codebuddy/messages/outbox.jsonl` artifact by default; live delivery requires `approved_by`, passes through `SendPolicyEngine`, and then uses `ChannelManager`.
  - Guardrail: never send externally without configured channel and explicit approval policy.
  - Verification:
    - `npm test -- tests/tools/send-message-real.test.ts --run`
    - `npm test -- tests/tools/hermes-core-aliases-real.test.ts tests/tools/send-message-real.test.ts tests/tools/kanban-real.test.ts --run`
    - `(cd cowork && npm test -- tests/test-runner-bridge-catalog.test.ts --run)` confirms the safe Cowork Test Runner smoke entry.

## P3 — Decide on optional ecosystem parity

- [x] **Kanban parity decision**
  - Done: Implemented exact `kanban_show/list/create/complete/block/comment/link/unblock/heartbeat` prompt tools on top of a persistent `.codebuddy/kanban-board.json` workspace board, plus `buddy hermes kanban *` CLI commands.
  - Remaining optional UX: add a Cowork board renderer if the Kanban becomes a daily coordination surface.
  - Verification:
    - `npm test -- tests/tools/kanban-real.test.ts --run`
    - `npm test -- tests/tools/hermes-core-aliases-real.test.ts tests/tools/send-message-real.test.ts tests/tools/kanban-real.test.ts --run`
    - `npx tsx src/index.ts hermes kanban list --json`

- [ ] **Runtime backend inventory**
  - Scope: detect/configure local, Docker, SSH, WSL, sandbox, Vercel Sandbox/Modal/Daytona if product-relevant.
  - Done so far: `buddy hermes doctor --json` and `buddy hermes runtime status --json` now report a non-destructive runtime backend inventory for local Node, native OS sandbox, Docker, WSL, SSH, Singularity/Apptainer, Modal, Daytona, and Vercel Sandbox. Each row reports installed/configured/runnable state, version when a real CLI probe can provide it, credential source names only, notes/remediation, and copy/paste smoke commands for heavier real validation. `buddy hermes runtime-smoke local --json`, `buddy hermes runtime-smoke wsl --json`, and Cowork's `tools.hermesRuntimeBackends.smoke` can run opt-in live smoke checks. The local Node and WSL runners execute real subprocesses; Docker remains guarded by `CODEBUDDY_HERMES_ALLOW_DOCKER_SMOKE=true`.
  - Acceptance: `buddy hermes runtime status --json` reports available backends and smoke commands. **Done for CLI JSON.**
  - Remaining scope: turn configured backends into first-class managed runners where product-relevant, and expand live smoke execution to Docker/remote backends after product-specific safety decisions.
  - Verification:
    - `cd cowork && npm test -- --run tests/hermes-runtime-backends-bridge.test.ts tests/hermes-runtime-backends-bridge-real.test.ts tests/hermes-runtime-backends-strip.test.ts`

- [ ] **Browser backend inventory**
  - Scope: detect/configure local Playwright, remote CDP, Browserbase/Stagehand, Browser Use gateway, Firecrawl, Camofox/Camoufox, and session recording.
  - Done so far: `buddy hermes doctor --json` and `buddy hermes browser status --json` now report browser backend readiness with credential source names only. `buddy hermes browser-smoke local-playwright --json` launches a real headless Chromium page and verifies the local browser binary, not just package presence. Cowork renders the same readiness in Settings -> API and Fleet Command Center through `tools.hermesBrowserBackends.get`, and can trigger the local smoke through `tools.hermesBrowserBackends.smoke`.
  - Acceptance: local Playwright backend status and smoke are machine-readable. **Done for CLI JSON, Cowork bridge/UI, and real local smoke.**
  - Remaining scope: first-class managed backend runners, hybrid routing, and full session recording.
  - Verification:
    - `cd cowork && npm test -- --run tests/hermes-browser-backends-bridge.test.ts tests/hermes-browser-backends-strip.test.ts`

- [x] **Yuanbao platform connector parity**
  - Done: exact `yb_query_group_info`, `yb_query_group_members`, `yb_send_dm`, `yb_search_sticker`, and `yb_send_sticker` prompt tools now exist.
  - Integration shape: optional Yuanbao-compatible HTTP gateway via `CODEBUDDY_YUANBAO_GATEWAY_URL` / `YUANBAO_GATEWAY_URL`, token via `CODEBUDDY_YUANBAO_TOKEN` / `YUANBAO_TOKEN`, and current chat fallback via `CODEBUDDY_YUANBAO_HOME_CHAT_ID` / `HERMES_SESSION_CHAT_ID`.
  - Guardrail: DM and sticker delivery require `approved_by` unless an operator explicitly sets `CODEBUDDY_YUANBAO_ALLOW_SENDS=true`.
  - Verification:
    - `npm test -- tests/tools/yuanbao-tool-real.test.ts --run`
    - `npm test -- tests/tools/discord-tool-real.test.ts tests/tools/homeassistant-tool-real.test.ts tests/tools/mixture-of-agents-real.test.ts tests/tools/spotify-tool-real.test.ts tests/tools/feishu-tool-real.test.ts tests/tools/yuanbao-tool-real.test.ts tests/tools/x-search-tool-real.test.ts --run`
    - `npx tsx src/index.ts hermes tools --json`

## Immediate next implementation order

1. Cowork provider/model readiness polish for media, tool parity, and skill lifecycle.
2. Optional full-page Cowork skill manager if the Fleet cockpit strips become too cramped for daily use.
3. Provider/runtime readiness smoke matrix beyond local Node and first-class managed remote runner decisions.
4. OpenClaw migration last, after the Hermes core and cockpit work are stable.
