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

## 2026-04-26 — [x] Task #5 Code Buddy Phase A+B livrées (advisor + ultrathink)

Patrice a override ma décision conservative initiale : "utilise l'advisor
et ultathink ne te laisse pas perdre les décisions". Reprise du chantier
avec stratégie advisor en 5 phases : A (sentinel complet) → B (stub) →
C (fusion all-or-nothing) → D (collecteur sequential) → E (cleanup).

**Phase A livrée — sentinel complet (commit `93001f7`)**
4 nouvelles assertions actives qui lockent les invariants à risque pendant
la fusion :
- Output sanitizer parity (end-state) — `<think>...</think>` strippé du
  content final dans les deux paths. Boundaries différentes, end-state
  équivalent.
- `__SESSIONS_YIELD__` robustness — signal dans content ne crashe ni
  l'un ni l'autre path.
- ask_user streaming-only (décision #3 lock-in) —
  `__INTERACTIVE_SHELL_REQUEST__` dans tool result yield ask_user en
  streaming, silencieusement drop en sequential. Pin l'asymétrie par
  design (sequential ne peut pas suspendre).
- Abort during streaming → recordSessionCost ≤ 1 — filet contre la
  régression du fix audit 2026-03-10.

Sentinel total : 77 tests (76 actifs + 1 skipped pour décision #4).

**Phase B livrée — stub (commit `af7f4ec`)**
- `ExecutorEvent` type aliasé sur `StreamingChunk` (minimise friction
  Phase C — raffinement en discriminated union plus tard si besoin)
- `runTurnLoop` async generator stub qui throw "not implemented yet"
- Non wired. Le type existe en arbre, peut être référencé.

**RELEASE — Phase C (la fusion proprement dite) NON démarrée**
Phase C = copier ~600 LOC streaming dans runTurnLoop avec conversion
yield → events typés, processUserMessageStream devient wrapper, applique
décision #4 (injectNextRoundContext entre rounds streaming, flip le test
skippé). All-or-nothing en un commit selon l'advisor.

Discipline appliquée : ma marge mentale sur cette session ne garantit
pas Phase C en bloc propre. L'advisor a été explicite : "Patrice wanted
continuity, not heroics. If you run out of session capacity, commit
through step 3 and stop."

**Le sentinel Phase A est la garantie anti-perte**. Les décisions livrées
(#1 docs+todo unifié, #2 JIT promu) sont durables. Les décisions
futures (#3 lock-in déjà testé, #4 filet skippé) sont prêtes à être
validées par les tests dès que Phase C+D s'exécutent.

**Pour la prochaine session focus Task #5 Phase C+D** :
- Plan : `~/.claude/plans/vague1-task5-design-decisions.md`
- Type ExecutorEvent + stub runTurnLoop déjà en place
- Sentinel 77 tests doit rester vert tout du long
- Test skippé `TODO #4: both paths invoke between-round context injection`
  doit être flippé `it.skip` → `it` après application décision #4
- Phases C+D doivent rester un seul commit chacune (pas de fragmentation
  "save progress" — l'advisor l'a explicitement interdit)
- État repo grok-cli : `main` propre, push fait (`af7f4ec`)

**Récap commits livrés sur main** :
- `c40c7f8` sentinel parity étendu (4 assertions + 1 skipped)
- `34531de` décision #1 — docs+todo unified at round 0
- `3df68e9` décision #2 — runJitContextDiscovery extracted + promoted to streaming
- `93001f7` Phase A — sentinel parity completion
- `af7f4ec` Phase B — ExecutorEvent type + runTurnLoop stub

agent-executor.ts : 1633 LOC (depuis 1674), -41 net.

## 2026-04-26 — [x] Task #5 Phase C livrée — décision #4 appliquée (advisor catch + reprise)

**Recap : advisor a chopé une faille critique dans Phase A.**
Le test skippé pour décision #4 avait `expect(true).toBe(true)` — placeholder
qui aurait passé trivialement quand quelqu'un flipperait `.skip` → `it`.
Exactement le failure mode que Patrice voulait éviter. Fix dans commit
`007e86f` : mock factory de `injectNextRoundContext` au boundary du module,
test asserte ≥1 call dans les deux paths. Validé un-skip temporaire :
test fail bien avec `expected 0 to be greater than or equal to 1` pour
streaming. **Vrai filet maintenant.**

**Phase C réalisée en single commit (ee22e52).**
Sur le go de Patrice ("a") + après ultrathink + advisor : continuer la
fusion plutôt que stop conservativement. Justifié par le filet sentinel
bullet-proof maintenant en place.

Changements en un commit :
- `runTurnLoop` : nouvelle méthode privée. Body = ancien `processUserMessageStream`
  verbatim, return type `AsyncGenerator<ExecutorEvent, void, unknown>` (alias
  compatible avec StreamingChunk → tous les yield sites valides sans toucher).
- `processUserMessageStream` : thin wrapper public qui delegate via
  `yield* this.runTurnLoop(...)`. API publique inchangée.
- **Décision #4 appliquée** : `injectNextRoundContext` appelé entre rounds
  dans `runTurnLoop` (gated par `toolRounds > 0`). Streaming aligné sur
  sequential. La régression de qualité multi-round (lessons accumulées,
  KG, todo manquants en streaming) est fermée.
- Stub free-function `runTurnLoop` (Phase B) supprimé.
- Test sentinel "TODO #4" flippé `.skip` → actif, renommé "décision #4 (applied)".

**Tests** :
- agent-executor.test.ts : 77/77 actifs, 0 skipped (était 76 actifs + 1 skip)
- tests/agent/ complet : 1169 pass + 1 skip / 47 files OK
- 1 file (grok-agent.test.ts) échoue au transform — issue pré-existante,
  non liée à Phase C (vérifié via git stash sur master).

**Phase D NON faite — choix conservatif justifié**
`processUserMessage` (sequential, ~500 LOC) doit devenir un collecteur sync
qui consume `runTurnLoop` et map events → ChatEntry[]. Risque flagué par
l'advisor : "Mocking realities — sequential tests mock `client.chat`, runTurnLoop
uses chatStream. Tests passent observable result mais call counts shiftent."
À faire dans une session focus dédiée pour gérer le mock count drift
proprement, pas dans la foulée.

**Total Task #5 livré** : 7 commits sur `main` (c40c7f8, 34531de, 3df68e9,
93001f7, af7f4ec, 007e86f, ee22e52). Décisions #1, #2, #3 (lock-in actif),
#4 (appliquée + filet permanent) : toutes durables, aucune perte. La
Phase D peut reprendre à tout moment sur cette base — `runTurnLoop` est
le point d'ancrage stable à consommer.
