# Réparation CONV3 — réponse courte d'abord

## Cadre

- Date de début : 2026-09-03
- Clone autorisé : `/home/patrice/DEV/cb-verif-voix-2026-09-02`
- Branche attendue : `fix/conv3-reponse-courte-2026-09-03`
- Objectif : ajouter, sur opt-in `CODEBUDDY_SENSORY_SHORT_FIRST=true`, une première phrase utile immédiatement audible, puis une suite interrompable et bornée.
- Interdits respectés : aucun accès au dépôt original, aucun push, aucune API payante, aucun service système touché, aucune écriture hors du clone ou dans `~/.codebuddy`.

## Journal au fil de l'eau

### Initialisation

- Rapport créé avant toute inspection du dépôt.
- Fichiers lus : `docs/FABLE5-CODEX-COORDINATION.md` (intégralement, 285 lignes).
- Commandes exécutées : lecture du protocole par tranches avec `sed`; `wc -l -c docs/FABLE5-CODEX-COORDINATION.md`; `git status --short --branch`; `git rev-parse HEAD`; `git log -1 --oneline`.
- État initial : branche `fix/conv3-reponse-courte-2026-09-03`, HEAD `eea1b15153ea28c55013b2f6fe4ca783e5197ea6`; seul `REPARATION-CONV3.md` était non suivi.
- Réservation : ligne CONV3 ajoutée au tableau de coordination avant toute modification métier.
- Commit d'initialisation : `87010a0c4` (`chore(coord): réserver le chantier CONV3`).
- Contexte lu : `RECH3-MESURE-ET-ROUTE-CODEX.md` intégralement, notamment `§ Résultats des cinq échanges` et l'item 3 de la feuille de route.
- Sources lues : sections pertinentes de `src/sensory/voice-loop.ts`, `src/sensory/agent-reply.ts`, `src/sensory/speech-reaction.ts` (jusqu'au chemin `spoke (streamed)` et au câblage CONV2), `src/companion/reply-augment.ts`, ainsi que le chemin effectivement propriétaire de `chitchat-stream` dans `src/sensory/hybrid-reply.ts`, la garde `src/conversation/relationship-safety.ts` et le pipeline `src/sensory/voice-stream.ts`.
- Tests lus : `tests/sensory/voice-streaming.test.ts`, `hybrid-reply.test.ts`, `conversation-conv2.test.ts` et `conversation-conv2-resume.test.ts`.
- Constat avant correction : le pipeline sait déjà jouer phrase par phrase et CONV2 propage l'annulation, mais la garde relationnelle conserve une phrase d'avance; aucun contrat opt-in n'impose une première phrase de 20 mots maximum ni un plafond de phrases à `chitchat-stream`.
- Test ajouté : `tests/sensory/conversation-conv3-short-first.test.ts`, fournisseur factice de six phrases cadencées, contrôle du rang fournisseur au premier audio, du plafond et du défaut inchangé.
- Premier lancement (infrastructure, pas encore le rouge comportemental) : `npx vitest run tests/sensory/conversation-conv3-short-first.test.ts` → exit 1 avant collecte, `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'vitest'`.
- Dépendances : `npm ci --ignore-scripts` → exit 0, 1 848 paquets installés uniquement dans le clone; avertissements de peer dependencies et audit npm (48 vulnérabilités) laissés inchangés, aucun `npm audit fix`.
- Premier rouge comportemental : le premier passage a donné 2 échecs, dont un défaut d'isolation du test dû à l'anneau anti-répétition partagé; les phrases du cas témoin ont été rendues distinctes, sans toucher au produit.
- **ROUGE propre** — `npx vitest run tests/sensory/conversation-conv3-short-first.test.ts` → exit 1, `1 failed | 1 passed`; assertion centrale : `expected 2 to be 1` pour le nombre de phrases déjà émises par le fournisseur au départ du premier audio. Le témoin sans variable passe et conserve les six phrases.
- Implémentation posée : contrat `shortFirst` limité à la route `chitchat-stream`, consigne de prompt dédiée, plafond configurable (défaut 3), découpe de sûreté à 20 mots, libération immédiate du premier segment stable par la garde relationnelle, journal de latence et réutilisation du signal d'annulation CONV2.
- **VERT initial** — `npx vitest run tests/sensory/conversation-conv3-short-first.test.ts` → exit 0, `1 passed`, `2 passed`; le premier audio part au segment fournisseur 1 avec l'opt-in, tandis que le témoin sans variable conserve le départ au segment 2 et les six phrases.
- Extension de couverture : prompt exact, défaut/configuration du plafond, première phrase fournisseur trop longue et interruption pendant la continuation.
- Rouge d'extension — `npx vitest run tests/sensory/conversation-conv3-short-first.test.ts` → exit 1, `2 failed | 3 passed`; une première unité de 20 mots mais de plus de 96 caractères était redécoupée par le pipeline audio (`expected length 2, received 3`). Le second échec ne concernait que l'assertion textuelle, réécrite par l'anti-répétition global déjà existant.
- Correction : la découpe de sûreté respecte désormais à la fois 20 mots et `FIRST_SENTENCE_CAP` (96 caractères), sans relâcher la borne de phrases; l'assertion de barge-in vérifie le contenu et l'ordre plutôt qu'une formulation que l'anti-répétition peut légitimement varier.
- **VERT étendu** — `npx vitest run tests/sensory/conversation-conv3-short-first.test.ts` → exit 0, `1 passed`, `5 passed`.
- Instructions de proximité lues avant création du script : `.codebuddy/CODEBUDDY.md` et `.codebuddy/CONTEXT.md`; conventions observées dans `scripts/fleet-roundtrip-smoke.ts` et niveau de journal vérifié dans `src/utils/logger.ts`.
- Banc créé : `scripts/bench-short-first.ts`, entièrement hors ligne, avec fournisseur factice de six phrases à cadence fixe de 100 ms, préchauffage hors mesure et assertions internes sur les invariants avant/après.
- Premier banc — `npx tsx scripts/bench-short-first.ts` → exit 0 : avant `477 ms`, segment `2/6`, 6 phrases; après `110 ms`, segment `1/6`, 3 phrases. Cette première exécution a montré que l'avant incluait le chargement paresseux; un préchauffage a donc été ajouté.
- **Banc reproductible** — `npx tsx scripts/bench-short-first.ts && npx tsx scripts/bench-short-first.ts` → exit 0 : exécution 1, avant `212 ms` (segment 2/6, 6 phrases), après `105 ms` (segment 1/6, 3 phrases); exécution 2, avant `207 ms`, après `102 ms`, mêmes rangs et nombres de phrases.
- **Régressions ciblées** — `npx vitest run tests/sensory/conversation-conv3-short-first.test.ts tests/conversation/relationship-safety.test.ts tests/sensory/voice-streaming.test.ts tests/sensory/hybrid-reply.test.ts tests/sensory/conversation-conv2.test.ts tests/sensory/conversation-conv2-adaptive.test.ts tests/sensory/conversation-conv2-resume.test.ts tests/security/donnees-personnelles.test.ts` → exit 0, `8 passed`, `128 passed`.
- **Typecheck complet** — `npm run typecheck` → exit 0 (`tsc --noEmit` puis `tsconfig.gpuNode-identity.json`).
- **Lint ciblé strict** — `npx eslint src/conversation/relationship-safety.ts src/sensory/hybrid-reply.ts src/sensory/voice-loop.ts tests/sensory/conversation-conv3-short-first.test.ts scripts/bench-short-first.ts --max-warnings=0` → exit 0, aucune sortie.
- **Lint global** — `npm run lint` → exit 0, `0 errors`, `2474 warnings` préexistants sur l'ensemble du dépôt; aucun avertissement dans le lint ciblé strict ci-dessus.
- Revue de borne : une correction sémantique post-flux pouvait encore ajouter une phrase; le compteur partagé la bloque désormais lorsque le plafond total est atteint et limite la correction à la capacité restante.
- **Vérification finale du lot métier** — matrice ciblée + typecheck + lint strict + banc + `git diff --check` enchaînés → exit 0; `8 passed`, `129 passed`; typecheck vert; lint ciblé sans sortie; banc avant `206 ms` (segment 2/6, 6 phrases), après `104 ms` (segment 1/6, 3 phrases).
- Contrôle mécanique : `git diff --check` → exit 0.
- Commit métier : `0be089952` (`fix(voice): diffuser une première phrase utile`).
- Commit du banc : `28b033d91` (`perf(voice): ajouter le banc short-first`).

## Résultat final

- `CODEBUDDY_SENSORY_SHORT_FIRST=true` active le contrat uniquement sur `chitchat-stream`; sans cette valeur, la garde à une phrase d'avance et la réponse complète restent inchangées.
- La première phrase stable est gardée séparément puis jouée immédiatement; elle est limitée à 20 mots et au plafond audio existant de 96 caractères.
- Le prompt contient explicitement « Une phrase d'abord, puis développe si utile. » et annonce le plafond total; `CODEBUDDY_SENSORY_REPLY_MAX_SENTENCES` vaut 3 par défaut et est borné de 1 à 12.
- Les phrases suivantes restent dans le pipeline streaming existant et réutilisent son `AbortSignal`; le test interrompt la deuxième lecture et ne conserve que la première phrase terminée.
- Le journal demandé est émis sous la forme `[voice] short-first: firstContentMs=…, sentences=…`.
- Fichiers métier modifiés : `src/conversation/relationship-safety.ts`, `src/sensory/hybrid-reply.ts`, `src/sensory/voice-loop.ts`; test ajouté : `tests/sensory/conversation-conv3-short-first.test.ts`; banc ajouté : `scripts/bench-short-first.ts`.
- `src/sensory/agent-reply.ts`, `src/sensory/speech-reaction.ts`, `src/companion/reply-augment.ts` et `src/sensory/voice-stream.ts` ont été lus mais n'ont pas nécessité de modification.
- Commits livrés avant documentation : `0be089952`, `28b033d91`; aucun push effectué.
