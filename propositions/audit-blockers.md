# Audit blockers — index vivant

Liste des points soulevés en audit qui ne sont **pas encore résolus**.
Index plat, append-only au-dessus (newest first). Quand un blocker
est fermé, déplace-le dans la section "Recently closed" en bas avec
le commit hash.

Convention par item :

```
- **<short title>** — <where it came from> · <severity> · <owner?>
  <one-paragraph context + what unblocks it>
```

---

## Open

### Code Buddy V1 GA prep

- **`npm audit` reports 19 critical vulns** — `etat_projets.md` notes
  CI billing failures. `npm audit fix --force` risks breaking
  dependencies but is necessary before V1 GA. Severity: blocker for
  GA shipping.
  Unlock: triage which fixes are safe (most are dev-only deps,
  e.g. xlsx/minizip in tests) and apply `--force` only on prod-path
  deps. Plan in a dedicated `PLAN-NPM-AUDIT-YYYY-MM-DD.md`.

- **`docs/deployment.md` is missing** — no Docker/K8s/systemd guide
  for ops who want to run `buddy serve` in production. Severity:
  medium (users figure it out, but the "first prod deploy" experience
  is rough). Tracked here as a follow-up to the V1.2 sprint.

- **OpenAPI spec not generated** — 36 API routes documented in code
  but no spec file or `/api/docs` endpoint. Severity: low for V1
  (CLI is the primary surface), medium for V2 (multi-client).

- **DB migration process for V1 GA** — `src/database/migration.ts`
  exists but no end-to-end test of "upgrade an old install through
  all migrations cleanly". Severity: medium-high. Risk: existing
  users hit a half-applied schema on V1 release.

### Fleet (post-V1.2.x)

- **V1.3 `peer.tool.invoke` permission design** — exposing local
  tools to remote callers needs a permission model. Whitelist?
  Per-tool scope? Audit log requirements? Currently parked.
  Source: `docs/fleet-guide.md` roadmap.

- **OpenClaw daemon not installed on Ministar** — Phase (e).7
  (`openclaw-node` bridge for multi-channel dispatch) is blocked on
  the daemon being available locally. Reportable as an external
  dependency, not actionable in-repo.

### Cowork

- **A2A active tasks tracking is polling-driven** — `SettingsA2AAgents
  .tsx:151` polls every N s instead of subscribing to a real-time
  IPC event. Severity: low (cosmetic), medium when scaling to >10
  concurrent tasks.

- **Feishu channel message decryption** — `feishu-channel.ts` has a
  TODO for XML signature verify + AES decrypt. Severity: high
  (security-sensitive). Should NOT ship to prod without audit.

- **Image + voice routing TODOs in `message-router.ts`** — image
  base64 conversion + voice transcription paths are stubs. Depends
  on the Feishu decryption being fixed first if those channels are
  the primary path.

### Tests / coverage

- **9 skipped tests in `tests/unit/agent-core.test.ts`** — context
  compression + cost limits + tool round limits, blocked on mock
  setup for `runTurnLoop`. Owner: Claude. Severity: low-medium
  (coverage signal). Not on the V1 GA critical path.

- **`tests/unit/scripting-parser.test.ts` is entirely
  `describe.skip`** — legacy parser, replaced by the new module.
  Resolution: rename to `*.skipped.legacy` or delete + mention in
  commit.

---

## Recently closed

> Move items here when you ship the fix. Format: `- <title> — <commit
> hash + date>` plus a one-line note.

- **Cowork engine path fails in manual electron launch** — fixed in
  `71865d19` (2026-05-10) with the `dev-from-bundle` resolver layer
  + the diagnostic log line + `cowork/DEV-LINUX.md` section. The
  symptom in the audit was misdiagnosed as "file missing"; the
  enriched log confirmed `app.getAppPath()` resolved to
  `cowork/dist-electron/main` under manual launch.

- **`peer.chat-session.*` no cross-restart durability** — closed by
  the V1.2-saga work in `1f89fedf` (2026-05-10). Sessions persist
  to `~/.codebuddy/peer-sessions/<sessionId>.json`, hydrate at boot.

- **`/fleet history` had no filter / no JSON output** — closed by
  `c9278fb6` (2026-05-11) with `--type <glob>` + `--json` flags.

- **Privacy lint had no PII patterns (SSN, IBAN, phone, CC)** —
  closed by `8a2ace28` (2026-05-11). Adds 4 PII patterns with Luhn
  gating on credit cards to suppress false positives.
