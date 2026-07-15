# SPEC-CB2 — INNOV-6 : Contexte hiérarchique zoom-in (compaction sans perte récupérable)

Tu travailles dans un worktree git du repo **Code Buddy** (agent de codage IA multi-provider,
TypeScript strict ESM, tests Vitest). Branche : `cb2/context-zoom`. Campagne « Code Buddy 2 ».

## Règles du repo (OBLIGATOIRES)
- Imports relatifs avec extension `.js` même depuis des `.ts`. Pas de `any`. `noUncheckedIndexedAccess` ON.
- `logger` (`src/utils/logger.js`) en production, jamais `console.*`.
- Fichiers kebab-case ; tests UNIQUEMENT sous `tests/` : `npm test -- tests/<fichier>`.
- Feature OPT-IN (`CODEBUDDY_CONTEXT_ZOOM=true`) — défaut ⇒ ZÉRO changement (la compaction actuelle
  reste byte-identique). Never-throws : une panne d'archivage n'empêche jamais la compaction.
- Conventional Commits. Avant chaque commit : `npm run typecheck` (0 erreur) + tes tests ciblés verts.
  N'exécute PAS la suite complète. `npm install --no-audit --no-fund` si node_modules manque.
- Ne commite jamais : SPEC-CB2.md, node_modules, état `.codebuddy/`.
- Documente dans `docs/cb2/context-zoom.md`. NE MODIFIE PAS CLAUDE.md.

## Mission
La compaction de contexte devient **sans perte récupérable** : quand un bloc de messages est
résumé, les originaux sont archivés et indexés ; le résumé injecté porte un marqueur
`[segment:<id>]` ; un nouveau tool `context_expand` permet au LLM de récupérer le contenu exact
d'un segment quand il en a besoin. Résumé de résumés + rappel exact = contexte quasi illimité,
là où tous les concurrents compactent avec perte.

## Ancrage dans l'existant (à lire d'abord)
- `src/context/context-manager-v2.ts` — le gestionnaire (sliding window + summarization). Repère
  le point EXACT où un bloc de messages est remplacé par son résumé.
- `src/context/compaction/` — le moteur de compaction et ses events (`compaction:start/complete`).
- `src/context/transcript-repair.ts` — contexte : la structure des messages doit rester valide.
- Ajout d'un tool : suis le protocole complet du CLAUDE.md §« Adding a Tool » — classe dans
  `src/tools/`, définition dans `src/codebuddy/tools.ts`, dispatch dans
  `CodeBuddyAgent.executeTool()`, enregistrement dans `src/tools/registry/`, metadata dans
  `src/tools/metadata.ts` (PAS fleetSafe — le contexte est privé).

## Périmètre P0
1. `src/context/segment-archive.ts` :
   - `class SegmentArchive` : stocke les messages originaux d'un segment compacté sous
     `~/.codebuddy/context-archive/<sessionId>/<segmentId>.json`
     (`{segmentId, sessionId, ts, messages, tokenEstimate, summaryPreview}`).
   - `archive(sessionId, messages, summary) → segmentId` (id = hash court du contenu),
     `get(sessionId, segmentId)`, `list(sessionId)`. Écritures atomiques (tmp+rename),
     never-throws (échec ⇒ null + log warn).
   - Rétention : `CODEBUDDY_CONTEXT_ZOOM_MAX_MB` (défaut 200) — purge LRU par session au-delà.
2. Câblage compaction : gardé par `CODEBUDDY_CONTEXT_ZOOM=true` — au moment où le résumé remplace
   les originaux, archiver ET préfixer le résumé de `[segment:<id>] `. Échec d'archivage ⇒
   compaction inchangée sans marqueur.
3. Tool `context_expand` :
   - Params : `{segment_id: string, max_tokens?: number}` (défaut 4000, borne dure 8000).
   - Retourne les messages originaux du segment rendus en texte lisible (rôle + contenu), tronqués
     au budget ; segment inconnu ⇒ erreur propre. Session courante uniquement.
   - Visible seulement quand `CODEBUDDY_CONTEXT_ZOOM=true` (regarde comment d'autres tools
     conditionnels sont filtrés dans `src/codebuddy/tools.ts` / le registry).
4. Description du tool : indique clairement au LLM d'utiliser `context_expand` quand un résumé
   `[segment:…]` ne suffit pas pour répondre précisément.

## Tests exigés (`tests/context/segment-archive.test.ts` + `tests/tools/context-expand.test.ts`)
- Archive : round-trip archive/get, ids stables, atomicité (pas de fichier partiel après crash
  simulé — écriture tmp+rename), purge LRU au-delà du quota, never-throws sur dossier en lecture seule.
- Câblage : compaction avec env ⇒ résumé préfixé `[segment:id]` + archive présente ; sans env ⇒
  résumé byte-identique à l'existant (test de non-régression sur le texte produit).
- Tool : expand nominal, budget tokens respecté (troncature), segment inconnu ⇒ error, env
  absente ⇒ tool absent de la liste exposée.

## Critères de done
- `npm run typecheck` : 0 erreur. Tests ciblés verts.
- Sans `CODEBUDDY_CONTEXT_ZOOM`, la compaction est byte-identique (prouvé par test).
- `docs/cb2/context-zoom.md` écrit. Commits `feat(context): …`.

## Interdits
- Ne change RIEN à la logique de choix des blocs à compacter ni aux budgets existants.
- N'archive jamais en dehors de `~/.codebuddy/context-archive/`. Pas de fleetSafe sur le tool.
- Ne touche pas à `transcript-repair.ts`.
