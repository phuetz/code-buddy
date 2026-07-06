# File de briefs Codex — plan de consommation continue

Modèle : **brief auto-suffisant → `buddy --yolo -p` one-shot** dans un **worktree isolé créé par Fable** (pas de course git, pas de re-réveil = pas de runaway). Codex tourne sur gpt-5.5 (OAuth, $0 marginal). Fable gate (tsc + tests + vite build, no-mocks) + câble (god-files) + merge.

**Règle d'or** : zones **disjointes** entre vagues parallèles ; les vagues qui dépendent des types d'une autre sont **séquentielles** (après merge).

## EN COURS (3 vagues parallèles, lancées 2026-07-05)
| # | Vague | Worktree / branche | Zone (disjointe) | Statut |
|---|---|---|---|---|
| 1 | **App Studio** (bolt.diy-like) | `appstudio-wt` / `feat/cowork-app-studio` | `cowork/src/{main,renderer/components}/studio/` | 🔄 tourne |
| 2 | **Agentic OS — Mission Control** | `agenticos-wt` / `feat/cowork-agentic-os` | `cowork/src/renderer/components/os/` | 🔄 tourne |
| 3 | **Noyau — nouveaux tools agent** | `coretools-wt` / `feat/core-agent-tools` | `src/tools/` | 🔄 tourne |

Briefs : `COWORK-APP-STUDIO-BRIEF.md`, `COWORK-AGENTIC-OS-BRIEF.md`, `CORE-AGENT-TOOLS-BRIEF.md`.

## FILE (à lancer après gate+merge des dépendances)
| # | Vague | Zone | Dépend de | Volume |
|---|---|---|---|---|
| 4 | **App Studio v2 — Déploiement/Git/Export** : déployer l'app générée (static/surge), init+commit git, export zip, preview partageable (cloudflared `expose` existe), templates additionnels | `cowork/.../studio-deploy/` | Vague 1 mergée (types `studio-api`) | ~10 tranches |
| 5 | **Agentic OS v2 — Actions de contrôle** : depuis le cockpit, piloter (pause/resume mission, re-router, ajuster autonomie, ack alertes) — passe de présentation → interactif | `cowork/.../os-actions/` | Vague 2 mergée | ~10 |
| 6 | **Noyau tools v2** : `deploy_static`, `lint_project`, `test_runner`, `format_project`, `bundle_analyze`, `license_check`, `sbom_generate` | `src/tools/` | Vague 3 mergée (évite collision fichiers) | ~10 |
| 7 | **Data-viz partagée** : composants de graphes réutilisables (sparkline, barres, donut, heatmap, timeline) props-driven, sans lib, que les vues OS/Studio importent | `cowork/.../viz/` | — (parallélisable) | ~12 |
| 8 | **Générateurs de livrables — logique réelle** : brancher SlideDeck/Sheet/Doc/Podcast (composants Genspark existants) sur les vrais skills pptx/xlsx/docx + preview | `cowork/.../deliverables/` + skills | Genspark câblé | ~10 |
| 9 | **Onboarding & Settings modernisés** : onboarding 1-écran vivant (détection $0), settings repensés par domaine | `cowork/.../onboarding2/` | — | ~8 |

## PASSES DE CÂBLAGE (Fable, entre les vagues — le vrai goulot)
Chaque vague produit des composants/tools **dormants** (interdits de toucher les god-files). Fable les monte en une passe via le **manifeste** de chaque vague :
- Genspark (~50 composants) → `genspark-slices.ts` — **à câbler**
- App Studio → `app-studio-wiring.ts` — après merge
- Agentic OS → `agentic-os-wiring.ts` — après merge
- Core tools → `authored-tools-manifest.ts` — après merge (registry : `tools.ts` + `executeTool` + registry factory + `metadata.ts`)

Ordre recommandé : **gate+merge les 3 en cours → une grande passe de câblage → valider en GUI (Patrice) → lancer 4-9**.

## Garde-fous (leçons de la session)
- Worktree **créé par Fable** (pas par l'agent) quand plusieurs tournent → pas de course sur `.git/worktrees/`.
- One-shot `buddy -p` : se termine, **ne se re-réveille pas** (≠ subagent background qui a déraillé plus tôt).
- Gate sur le **checkout principal** (node_modules complet), pas dans le worktree (tsc y montre de fausses erreurs `Cannot find module 'openai'`).
- Surveiller `git log`/`ps` : ne jamais nettoyer un worktree tant que son agent tourne.

## SALVE DU 2026-07-06 SOIR (demande Patrice : « fais travailler Codex »)
Compilée depuis AUTOPILOT-STATE + audits du jour (bolt.new, Genspark, Hermes/OpenClaw).
Stalls backend désormais BORNÉS par la garde anti-stall (7c3c9639, 120 s par tour).

| # | Vague | Worktree / zone | Contenu | Statut |
|---|---|---|---|---|
| A | **Purge warnings lint** | `codex-lint-wt` (worktree isolé) | corriger ~61 warnings cowork sans changer le comportement (unused, échappements) ; interdit de désactiver des règles | lancée |
| B | **Terminal interactif studio** (présentationnel) | `codex-term-wt` / fichiers NOUVEAUX `studio/terminal-input-*` | modèle pur historique (flèches ↑↓) + TerminalInput.tsx (props onRun/busy/history) + tests ; câblage IPC réservé à Fable | lancée |
| C | **Timeline checkpoints studio** (présentationnel) | `codex-ckpt-wt` / fichiers NOUVEAUX `studio/checkpoint-timeline-*` | modèle pur tri/groupage + CheckpointTimeline.tsx (onRestore/onDiff) + tests ; câblage réservé à Fable | lancée |

Backlog suivant : métadonnées médias (prompt d'origine, core), e2e confirmation organique,
app vitrine vidéo hero e2e, /video /image slash CLI.
