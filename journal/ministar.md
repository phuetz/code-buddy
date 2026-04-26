# Journal — MINISTAR (G7 PT, Windows)

Écritures depuis la machine `MINISTAR`. Voir `README.md` pour la convention.

---

## 2026-04-26 — Convention "fichier par source" mise en place

Ouverture de ce fichier suite à un conflit de merge sur `journal.md` plus
tôt dans la journée. Une autre session Claude (probablement depuis cette
même machine en parallèle) avait poussé 3 commits sur `etat_projets.md` +
`journal.md` pendant que je préparais mes propres modifications. Résolution
manuelle propre, mais le scénario va se répéter sans changement de structure.

Patrice a validé la convention :

- `../journal.md` devient l'index consolidé **figé** jusqu'au 26 avril 2026.
- À partir d'aujourd'hui, chaque IA écrit dans `journal/<hostname>.md` —
  zéro zone partagée écrite en parallèle, donc zéro conflit physique.
- Détails dans `README.md` de ce dossier.
- Section ajoutée à `../COLAB.md` (la spec canonique).
- `../BRIEFING_NOUVEAU_CLAUDE.md` mis à jour pour briefer toute IA qui
  démarre.

Mapping initial : `MINISTAR` → `ministar.md`, `DARKSTAR` → `darkstar.md`.
À enrichir au fil des nouvelles machines.

Reste comme limite connue (déjà notée dans COLAB.md) : `etat_projets.md`
peut encore subir des conflits si deux IA modifient la même section. Règle
simple en attendant : `git pull --rebase` avant édition + préférer ajouter
une nouvelle section plutôt que toucher une existante.

## 2026-04-26 — [~] Code Buddy Vague 1 / Task #5 démarrée

**Claim** : je prends Task #5 (fusion async iterator unique) sur
`D:\CascadeProjects\grok-cli`. Plan : `~/.claude/plans/vague1-task5-design-decisions.md`
(6 KB, 25 avril). Pendant ce temps, Patrice merge `feat/semantic-search`
sur master côté gitnexus-rs.

**Étapes** (8 du plan, dans l'ordre) :
1. Étendre le sentinel parity pour couvrir multi-round + injection round-suivant
2. Étendre `injectInitialContext` pour inclure docs + todo (décision #1)
3. Extraire `runJitContextDiscovery` (décision #2)
4. Définir le type `ExecutorEvent` + stub `runTurnLoop`
5. Migrer la logique de `processUserMessageStream` → `runTurnLoop`
6. Réécrire `processUserMessageStream` en thin wrapper
7. Réécrire `processUserMessage` en collecteur sync des events
8. Tests verts → commit + update CLAUDE.md

**Filet** : 68 tests verts à chaque étape, sinon stop.
Si une autre IA voit ce claim : ne pas toucher `agent-executor.ts` ni
les modules dans `src/agent/execution/`.

## 2026-04-26 — [x] Task #5 Code Buddy — partiel livré, fusion steps 4-7 RELEASE

**Livré (3 commits sur main)** :
- `c40c7f8` — sentinel parity étendu : 4 nouveaux assertions actives
  (prepareMessages count, tool dispatch count, recordSessionCost ×1
  parity sur single + multi-round) + 1 skipped (filet décision #4
  — `injectNextRoundContext` between rounds, à activer quand la décision
  sera implémentée). 73 tests dans agent-executor.test.ts.
- `34531de` — décision #1 : `injectInitialContext` étendu pour inclure
  les blocs `docs` et `todo` au round 0. Suppression de ~36 lignes
  dupliquées entre les deux paths.
- `3df68e9` — décision #2 : extraction de `runJitContextDiscovery(toolCall)`
  dans `context-pipeline.ts`, promotion au streaming. Le streaming
  bénéficie maintenant du même enrichissement JIT que le sequential
  après chaque tool qui touche un path.

**LOC** : agent-executor.ts 1674 → 1633 (-41). Tests : 72 pass + 1 skipped
à chaque commit, zéro régression.

**RELEASE — steps 4-7 NON démarrés** : la fusion proprement dite
(ExecutorEvent union, runTurnLoop async generator, adaptation des deux
entry points en wrappers) demande un bloc continu de 1-2 jours focalisés
selon le plan. L'advisor a explicitement dit "A half-done unification
is worse than two paths" — steps 4-7 sont indivisibles.

Discipline `feedback_pace_and_advisor.md` appliquée : stop ici, pas de
"continue" réflexe.

**Pour la prochaine session qui reprendra Task #5** :
- Plan complet : `~/.claude/plans/vague1-task5-design-decisions.md`
  (toujours d'actualité, décisions #1 et #2 ✅, restent #3 + #4)
- Filets à activer pour valider la fusion :
  - test skippé `TODO #4: both paths invoke between-round context injection`
    devra passer après application de la décision #4
  - sentinel parity actuel doit rester vert tout du long (72 tests)
- Invariants identifiés par l'advisor mais non testés (à couvrir dans
  le sentinel quand on attaquera les steps 4-7) :
  - `__SESSIONS_YIELD__` event placement dans l'ExecutorEvent union
  - output sanitizer chunk-vs-final boundary
  - runtime state (roundsExecuted, abortController granularity)
  - JIT context #2 → ✅ FAIT, déjà parité testable
  - ask_user streaming-only boundary #3
- État du repo : `main` propre, push fait (`3df68e9` → origin)

**Pendant ce temps côté gitnexus-rs** : Patrice est en train de merger
`feat/semantic-search` sur master (en cours quand on a parlé). Le brief
nuit_25avril_gitnexus.md a été exécuté à la lettre par l'autre Claude :
pollution Git nettoyée, fichiers hors scope sortis, README FR/EN updaté,
21 commits prêts pour merge. 67% strictly improved sur Alise_v2.
