# SPEC-CB2 — INNOV-4 : CKG fédéré (mémoire collective inter-pairs)

Tu travailles dans un worktree git du repo **Code Buddy** (agent de codage IA multi-provider,
TypeScript strict ESM, tests Vitest). Branche : `cb2/ckg-federation`. Campagne « Code Buddy 2 ».

## Règles du repo (OBLIGATOIRES)
- Imports relatifs avec extension `.js` même depuis des `.ts`. Pas de `any`. `noUncheckedIndexedAccess` ON.
- `logger` (`src/utils/logger.js`) en production, jamais `console.*` (sauf sortie CLI dans `src/commands/`).
- Fichiers kebab-case ; tests UNIQUEMENT sous `tests/` : `npm test -- tests/<fichier>`.
- Feature OPT-IN (`CODEBUDDY_CKG_SYNC=true` requis DES DEUX CÔTÉS) — défaut ⇒ ZÉRO changement.
  FAIL-CLOSED : env absente ⇒ la méthode peer répond par une erreur explicite, jamais de données.
- Conventional Commits. Avant chaque commit : `npm run typecheck` (0 erreur) + tes tests ciblés verts.
  N'exécute PAS la suite complète. `npm install --no-audit --no-fund` si node_modules manque.
- Ne commite jamais : SPEC-CB2.md, node_modules, état `.codebuddy/`.
- Documente dans `docs/cb2/ckg-federation.md`. NE MODIFIE PAS CLAUDE.md.

## Mission
Le Collective Knowledge Graph (ledger JSONL append-only, `~/.codebuddy/collective/ckg-ledger.jsonl`)
se synchronise entre pairs de la fleet : ce qu'un agent apprend (leçons, faits), toute la flotte
le sait. Delta-based, provenance par pair, allowlist de types, fail-closed.

## Ancrage dans l'existant (à lire d'abord)
- `src/memory/collective-knowledge-graph.ts` — le CKG : types de nœuds (`lesson`/`decision`/`fact`/
  `discovery`), ledger append-only, corroboration cross-agents DÉJÀ native (réutilise-la : une
  entrée ingérée depuis un pair = un agent indépendant qui corrobore).
- `src/fleet/peer-chat-bridge.ts` et `src/fleet/peer-tool-bridge.ts` — LES modèles à imiter pour
  une nouvelle méthode peer : enregistrement dans `src/server/index.ts`, gates de sécurité en
  ordre, réponses d'erreur typées. `peer-tool-bridge.ts` montre le motif fail-closed
  (`PEER_WORKSPACE_NOT_CONFIGURED`).
- `src/server/websocket/` — transport des méthodes `peer.*`.

## Périmètre P0
1. `src/fleet/peer-ckg-bridge.ts` — nouvelle méthode **`peer.ckg.sync`** :
   - Requête : `{sinceTs?: number, types?: string[], limit?: number}` (limit ≤ 500, défaut 200).
   - Gates dans l'ordre : (a) `CODEBUDDY_CKG_SYNC=true` sinon erreur `CKG_SYNC_NOT_ENABLED`
     (fail-closed) ; (b) allowlist de types `CODEBUDDY_CKG_SYNC_TYPES` (csv, défaut `lesson,fact` —
     JAMAIS `decision` par défaut) ; (c) filtrage : les entrées dont la provenance est déjà un pair
     distant ne sont PAS re-servies (anti-boucle de ragots : on ne propage que son savoir de
     première main).
   - Réponse : entrées du ledger (JSON) + `maxTs` pour la pagination du prochain delta.
2. Ingestion côté demandeur : `pullFromPeer(peerId)` — appelle `peer.ckg.sync` avec le `sinceTs`
   mémorisé (état par pair dans `~/.codebuddy/collective/sync-state.json`), ingère chaque entrée
   via l'API d'ingestion existante du CKG avec provenance `peer:<peerId>`, dédup par id d'entrée
   (une entrée déjà vue n'est pas ré-ingérée), et laisse la corroboration native faire monter la
   confiance des faits confirmés par plusieurs pairs.
3. CLI : `buddy research sync <peer> [--dry-run]` (étend la commande research existante,
   `src/commands/research.ts` ou équivalent — trouve où `ingest|recall|stats` sont déclarés) :
   `--dry-run` affiche ce qui serait ingéré sans écrire.
4. Anti-boucle : profondeur non applicable (pull-only, pas de push), mais borne dure : max
   `CODEBUDDY_CKG_SYNC_MAX` entrées ingérées par run (défaut 1000).

## Tests exigés (`tests/fleet/peer-ckg-bridge.test.ts`)
- Fail-closed : env absente ⇒ `CKG_SYNC_NOT_ENABLED`, aucune lecture du ledger.
- Allowlist : types hors allowlist jamais servis ; défaut = lesson+fact seulement.
- Anti-ragot : une entrée de provenance `peer:X` n'est pas re-servie par le pair Y.
- Delta : deuxième sync avec `sinceTs` ⇒ seulement les nouvelles entrées ; `maxTs` correct.
- Ingestion : dédup par id ; provenance `peer:<id>` posée ; borne `CODEBUDDY_CKG_SYNC_MAX` respectée.
- Deux stores CKG sur tmpdir (pas de vrai WebSocket : transport mocké au niveau du bridge, motif
  des tests fleet existants).

## Critères de done
- `npm run typecheck` : 0 erreur. Tests ciblés verts.
- Sans `CODEBUDDY_CKG_SYNC`, la méthode répond fail-closed et rien d'autre ne change.
- `docs/cb2/ckg-federation.md` écrit (protocole, gates, anti-boucle). Commits `feat(fleet): …`.

## Interdits
- Pas de push (pull-only en P0). Pas de sync des nœuds `decision` par défaut.
- Ne modifie pas le format du ledger CKG (append d'entrées standard uniquement).
- Ne touche pas aux autres bridges fleet.
