# Code Buddy 2 — les 10 innovations

Campagne du 2026-07-15/16 : 10 innovations conçues pour surpasser Claude Code, Cursor,
OpenAI Codex CLI, Gemini CLI et Devin, développées en parallèle par Codex (gpt-5.6-sol)
dans 10 worktrees isolés, vérifiées indépendamment (typecheck 0 erreur + 209 tests),
puis mergées séquentiellement. Vision et audit : [`docs/audits/2026-07-15-code-buddy-2-vision.md`](../audits/2026-07-15-code-buddy-2-vision.md).
Specs d'origine : [`docs/specs/cb2/`](../specs/cb2/).

**Tout est opt-in** : sans les env vars ci-dessous, le comportement est strictement inchangé.

| # | Innovation | Doc | Activation | En une phrase |
|---|---|---|---|---|
| 1 | Shadow Workspace | [shadow-workspace.md](shadow-workspace.md) | `CODEBUDDY_SHADOW_WORKSPACE=true` | Chaque écriture est validée (typecheck/tests) dans un worktree fantôme AVANT de toucher tes fichiers ; `buddy shadow status\|run`. |
| 2 | Time-Travel Sessions | [time-travel.md](time-travel.md) | `CODEBUDDY_TIMELINE=true` | Timeline persistée par tour ; `buddy replay <session> [--at N] [--fork id]` : re-matérialiser un état, forker une session. |
| 3 | Intent Ledger | [intent-ledger.md](intent-ledger.md) | `CODEBUDDY_INTENTS=true` | Specs falsifiables versionnées (`.codebuddy/intents/`) ; `buddy intents new\|check\|drift` — le « done » devient un contrat re-vérifiable. |
| 4 | CKG fédéré | [ckg-federation.md](ckg-federation.md) | `CODEBUDDY_CKG_SYNC=true` (les 2 pairs) | `peer.ckg.sync` : la mémoire collective se synchronise entre pairs fleet (pull-only, delta, anti-ragot, fail-closed). |
| 5 | Self-Benchmark | [self-benchmark.md](self-benchmark.md) | `CODEBUDDY_SELF_BENCH=true` | `buddy improve bench --run\|--history\|--report` : capacité mesurée dans le temps, régressions détectées, scoreboard alimenté. |
| 6 | Contexte zoom-in | [context-zoom.md](context-zoom.md) | `CODEBUDDY_CONTEXT_ZOOM=true` | Compaction sans perte récupérable : segments archivés + tool `context_expand` pour dézoomer un résumé `[segment:…]`. |
| 7 | GUI générative | [generative-ui.md](generative-ui.md) | `CODEBUDDY_WIDGETS_AUTO=true` (+`CODEBUDDY_WIDGETS`) | Les réponses structurées (payloads, tableaux) proposent leur widget server-rendered ; réutilisation des widgets authored par type de données. |
| 8 | Pair perceptif | [perceptive-pair.md](perceptive-pair.md) | `CODEBUDDY_SENSORY_ERRORWATCH=true` (+`CODEBUDDY_SENSORY`) | Le screen-sense reconnaît une erreur à l'écran et Lisa propose son aide (débouncé, quota horaire, jamais d'action automatique). |
| 9 | Skill Exchange | [skill-exchange.md](skill-exchange.md) | `CODEBUDDY_SKILL_EXCHANGE=true` | Skills signés ed25519 (TOFU + re-scan firewall) ; `buddy skills exchange export\|verify\|install\|keys`. |
| 10 | Workspace multi-repo | [multi-repo.md](multi-repo.md) | `CODEBUDDY_WORKSPACE=true` + `workspace.json` | Tools `workspace_search`/`workspace_read` cross-repo (read-only, bornés) ; `buddy ws list\|add\|rm\|search`. |

## Réglages secondaires

| Env var | Défaut | Rôle |
|---|---|---|
| `CODEBUDDY_SHADOW_CMD` / `CODEBUDDY_SHADOW_TIMEOUT_MS` | auto / 120000 | Commande de validation du shadow (sinon auto-détection typecheck) et son timeout |
| `CODEBUDDY_INTENTS_TIMEOUT_MS` | 120000 | Timeout d'un critère d'intent |
| `CODEBUDDY_CKG_SYNC_TYPES` / `CODEBUDDY_CKG_SYNC_MAX` | `lesson,fact` / 1000 | Allowlist des types synchronisés / borne d'ingestion par run |
| `CODEBUDDY_SELF_BENCH_TIMEOUT_MS` / `_DROP` / `_HISTORY` | 60000 / 0.15 / `~/.codebuddy/capability-history.jsonl` | Timeout par scénario / seuil de régression relatif / chemin d'historique |
| `CODEBUDDY_CONTEXT_ZOOM_MAX_MB` | 200 | Quota LRU de l'archive de segments |
| `CODEBUDDY_WIDGETS_AUTOGEN` | off | Autorise la génération LLM d'un nouveau template en l'absence de match (re-gaté) |
| `CODEBUDDY_ERRORWATCH_VISION` / `_DEBOUNCE_MS` / `_MAX_PER_HOUR` | off / 120000 / 4 | Étage vision (keyframe→modèle local) / anti-harcèlement |
| `CODEBUDDY_WORKSPACE_TIMEOUT_MS` / `_MAX_FILE_KB` | 30000 / 512 | Bornes de la recherche/lecture cross-repo |

## Garanties transverses

- **Opt-in strict** : chaque feature est gardée par env var, prouvé par des tests de non-régression
  (« sans l'env var, byte-identique / aucun listener / tool absent »).
- **Fail-closed** sur les surfaces de confiance (installation de skills, sync fleet, lecture
  cross-repo) ; **never-throws/fail-open** sur les chemins de confort (timeline, archive de
  segments, shadow indisponible) — une panne de la feature ne casse jamais l'agent.
- **Read-only** partout où un pair ou un repo externe est touché (P0).
- Chaque vague a sa doc dédiée dans ce dossier (architecture, env vars, limites, menaces).
