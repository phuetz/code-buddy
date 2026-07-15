# SPEC-CB2 — INNOV-8 : Pair-programming perceptif (l'agent qui voit que tu bloques)

Tu travailles dans un worktree git du repo **Code Buddy** (agent de codage IA multi-provider,
TypeScript strict ESM, tests Vitest). Branche : `cb2/perceptive-pair`. Campagne « Code Buddy 2 ».

## Règles du repo (OBLIGATOIRES)
- Imports relatifs avec extension `.js` même depuis des `.ts`. Pas de `any`. `noUncheckedIndexedAccess` ON.
- `logger` (`src/utils/logger.js`) en production, jamais `console.*`.
- Fichiers kebab-case ; tests UNIQUEMENT sous `tests/` : `npm test -- tests/<fichier>`.
- Feature OPT-IN (`CODEBUDDY_SENSORY_ERRORWATCH=true`, en plus du gate global `CODEBUDDY_SENSORY`) —
  défaut ⇒ ZÉRO changement. Never-throws : le sensoriel ne crashe JAMAIS le serveur.
- Conventional Commits. Avant chaque commit : `npm run typecheck` (0 erreur) + tes tests ciblés verts.
  N'exécute PAS la suite complète. `npm install --no-audit --no-fund` si node_modules manque.
- Ne commite jamais : SPEC-CB2.md, node_modules, état `.codebuddy/`.
- Documente dans `docs/cb2/perceptive-pair.md`. NE MODIFIE PAS CLAUDE.md.

## Mission
Le screen-sense existant observe l'écran ; cette vague lui apprend à reconnaître les **situations
d'erreur** (stack trace, terminal en erreur, dialog d'échec) et à proposer de l'aide proactive —
une suggestion vocale/notification débouncée, jamais insistante. L'agent devient un pair qui voit
que tu bloques. Aucun concurrent n'a ça.

## Ancrage dans l'existant (à lire d'abord — IMPÉRATIF)
- `src/sensory/screen-reaction.ts` — LA réaction modèle : déclenchée par les percepts screen,
  débouncée, opt-in, analyse injectable. Ta réaction suit EXACTEMENT ce motif.
- `src/sensory/reactions.ts` + `src/sensory/sensory-bridge.ts` — comment les réactions s'abonnent
  aux `sensory:perception` du bus global ; câblage dans `src/server/index.ts` (cherche
  `wireSensory`/équivalent — ajoute le tien au même endroit, gardé par l'env var).
- `src/sensory/vision-reaction.ts` — le motif « analyse d'une keyframe par un modèle vision local
  injectable + cooldown de dédup » (`CODEBUDDY_VISION_MODEL`, moondream).
- `src/sensory/alert.ts` (`sayNow`, Telegram) — les canaux de sortie existants.
- `src/companion/orchestrator.ts` — le « conducteur » : une seule voix companion par fenêtre.
  Ta suggestion doit passer par lui (motif des autres réactions), pas le contourner.

## Périmètre P0
1. `src/sensory/error-watch-reaction.ts` :
   - S'abonne aux percepts screen (changement d'écran + keyframe) — motif screen-reaction.
   - Détection à deux étages, INJECTABLE pour les tests :
     (a) **étage rapide $0** : si le percept transporte du texte (OCR/dump AT-SPI si présent dans
     l'événement), regex d'indices d'erreur (`Traceback|Error:|Exception|FAILED|npm ERR!|panic:|
     segfault|Uncaught`) ;
     (b) **étage vision** (seulement si (a) inconclusif ET `CODEBUDDY_ERRORWATCH_VISION=true`) :
     la keyframe est passée à l'analyseur vision local injecté (motif vision-reaction) avec un
     prompt fermé « une erreur/stack trace est-elle visible ? réponds OUI/NON + une ligne ».
   - Anti-harcèlement : debounce `CODEBUDDY_ERRORWATCH_DEBOUNCE_MS` (défaut 120000), dédup par
     hash de l'indice détecté (la même erreur affichée 10× = 1 suggestion), max
     `CODEBUDDY_ERRORWATCH_MAX_PER_HOUR` (défaut 4).
   - Sortie : une suggestion courte (« Je vois une erreur <résumé> à l'écran — dis "aide-moi" si
     tu veux que je regarde ») via le conducteur companion (voix si présent, sinon rien — PAS de
     Telegram en P0). L'utterance est aussi poussée en percept mémoire courte (motif existant)
     pour que « aide-moi » derrière ait le contexte.
2. Câblage dans `src/server/index.ts` au même endroit que les autres réactions sensorielles,
   gardé par `CODEBUDDY_SENSORY_ERRORWATCH=true`.

## Tests exigés (`tests/sensory/error-watch-reaction.test.ts`)
Motif des tests sensoriels existants (`tests/sensory/` — bus d'événements réel, hardware mocké) :
- Étage rapide : percept avec texte contenant `Traceback` ⇒ suggestion émise (spy conducteur) ;
  texte sain ⇒ rien ; pas de texte + vision off ⇒ rien (l'analyseur vision n'est jamais appelé).
- Étage vision : activé + analyseur mocké OUI ⇒ suggestion ; NON ⇒ rien ; analyseur qui throw ⇒
  rien + pas de crash (never-throws).
- Debounce/dédup : deux percepts identiques dans la fenêtre ⇒ 1 suggestion ; quota horaire respecté.
- Env absente ⇒ la réaction n'est pas câblée (aucun listener ajouté).

## Critères de done
- `npm run typecheck` : 0 erreur. Tests ciblés verts (+ `npm test -- tests/sensory` toujours vert).
- Sans les env vars, aucun listener, aucun coût.
- `docs/cb2/perceptive-pair.md` écrit. Commits `feat(sensory): …`.

## Interdits
- Ne touche PAS au Rust (`buddy-sense/`) — TypeScript uniquement, les percepts existants suffisent.
- Jamais de capture/stockage d'image supplémentaire ; on consomme ce que le bus fournit déjà.
- Pas d'action automatique (pas d'agent turn, pas d'édition) — suggestion vocale UNIQUEMENT.
- Ne contourne pas le conducteur companion (une seule voix par fenêtre).
