# SPEC-CB2 — INNOV-2 : Time-Travel Sessions

Tu travailles dans un worktree git du repo **Code Buddy** (agent de codage IA multi-provider,
TypeScript strict ESM, tests Vitest). Branche : `cb2/time-travel`. Campagne « Code Buddy 2 ».

## Règles du repo (OBLIGATOIRES)
- Imports relatifs avec extension `.js` même depuis des `.ts`. Pas de `any`. `noUncheckedIndexedAccess` ON.
- `logger` (`src/utils/logger.js`) en production, jamais `console.*` (sauf sortie CLI dans `src/commands/`).
- Fichiers kebab-case ; tests UNIQUEMENT sous `tests/` : `npm test -- tests/<fichier>`.
- Feature OPT-IN par env var — env var absente/false ⇒ ZÉRO changement de comportement. Never-throws :
  une panne de la timeline ne casse jamais un tour d'agent (try/catch + log warn).
- Conventional Commits. Avant chaque commit : `npm run typecheck` (0 erreur) + tes tests ciblés verts.
  N'exécute PAS la suite complète. `npm install --no-audit --no-fund` si node_modules manque.
- Ne commite jamais : SPEC-CB2.md, node_modules, état `.codebuddy/`.
- Documente dans `docs/cb2/time-travel.md`. NE MODIFIE PAS CLAUDE.md.

## Mission
Les sessions deviennent des **états navigables**, pas des journaux : chaque tour est enregistré
dans une timeline (message, outils appelés, fichiers modifiés, checkpoint), et
`buddy replay` permet de lister les tours, re-matérialiser l'état des fichiers à un tour donné,
et **forker** une session à partir d'un tour.

## Ancrage dans l'existant (à lire d'abord)
- `src/agent/facades/session-facade.ts` — save/load des sessions, checkpoints, rewind (regarde ce
  qui existe déjà : il y a un CheckpointManager et un mécanisme de rewind — RÉUTILISE-les, ne les
  réimplémente pas).
- `src/agent/execution/agent-executor.ts` — `runTurnLoop` : la fin d'un tour est l'endroit où
  émettre l'entrée de timeline. Cherche un point d'accroche PROPRE (fin de tour, après push dans
  l'historique) et branche via un hook injecté, gardé par l'env var.
- `src/agent/facades/` — `MessageHistoryManager` pour le contenu des messages.

## Périmètre P0
1. `src/sessions/timeline.ts` :
   - `class SessionTimeline` : append-only JSONL par session sous
     `~/.codebuddy/timelines/<sessionId>.jsonl`.
   - `TimelineEntry` : `{turn, ts, role:'user'|'assistant', textPreview (≤400 chars),
     toolCalls: {name, ok}[], filesTouched: string[], checkpointId?: string}`.
   - `record(entry)`, `list(sessionId)`, `get(sessionId, turn)`. Écriture atomique (append),
     never-throws (erreur ⇒ log warn, retour silencieux).
2. Câblage : enregistrement à la fin de chaque tour dans `runTurnLoop`, gardé par
   `CODEBUDDY_TIMELINE=true`. Les fichiers touchés se déduisent des tool calls d'écriture du tour ;
   le checkpointId vient du CheckpointManager quand un checkpoint existe pour ce tour.
3. CLI `buddy replay` (nouveau `src/commands/replay.ts`, motif Commander existant, lazy-loadé
   depuis `src/index.ts`) :
   - `buddy replay <sessionId>` — table des tours (turn, heure, préviews, outils, fichiers).
   - `buddy replay <sessionId> --at N` — affiche l'état du tour N et, si un checkpoint existe,
     restaure les fichiers de ce checkpoint **après confirmation interactive** (flag `--yes` pour
     scripts). Réutilise l'API de restauration du CheckpointManager existant.
   - `buddy replay <sessionId> --at N --fork <newSessionId>` — crée une nouvelle session dont
     l'historique = les tours 1..N (via le format de session existant de SessionFacade), sans
     toucher à la session d'origine.
4. Rien côté UI/Cowork en P0.

## Tests exigés (`tests/sessions/timeline.test.ts` + `tests/commands/replay.test.ts`)
- SessionTimeline : record/list/get sur tmpdir, ordre des tours, never-throws si le dossier est
  inscriptible en lecture seule (simulé), preview tronquée à 400.
- Câblage : avec env var ⇒ un tour simulé écrit une entrée ; sans env var ⇒ aucun fichier créé.
- CLI : Commander `parseAsync()` + `exitOverride()`, mock `console.log`/`process.exit` (motif des
  tests CLI existants) — list, --at avec mock du CheckpointManager, --fork produit une session
  chargeable par SessionFacade.

## Critères de done
- `npm run typecheck` : 0 erreur. Tests ciblés verts.
- Sans `CODEBUDDY_TIMELINE`, aucun coût, aucun fichier créé (prouvé par test).
- `docs/cb2/time-travel.md` écrit. Commits Conventional (`feat(sessions): …`).

## Interdits
- Ne réimplémente NI les checkpoints NI le format de session — réutilise les APIs existantes.
- Aucune restauration de fichiers sans confirmation (ou --yes explicite).
- Ne stocke jamais le contenu complet des messages dans la timeline (préviews seulement — la
  session complète existe déjà ailleurs).
