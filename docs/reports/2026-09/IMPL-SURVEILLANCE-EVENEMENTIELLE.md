# IMPL — Surveillance événementielle par battements de cœur (Phases 1 & 2)

Branche : `feat/surveillance-evenementielle-2026-09-05`
Worktree : `~/DEV/cb-heartwatch-2026-09-05`
Mission : Phases 1 et 2 du plan `warm-moseying-zebra.md` (pas 3-5).
Début : 2026-09-05.

## Objectif
- Phase 1 : `src/sensory/system-vitals-emitter.ts` — passe pure/testable `runSystemVitalsPass(deps)`
  réutilisant les moniteurs existants ; garde « processus emballé » (N passes CPU au-dessus du seuil) ;
  émission directe sur le bus `sensory:perception` (modality:system). Enregistrement comme traitement
  de battement opt-in `CODEBUDDY_SYSTEM_VITALS=true`, cadence `CODEBUDDY_SYSTEM_VITALS_EVERY` (défaut 30).
- Phase 2 : opérateurs de seuil `{op,value}` dans `ruleMatches()` + `validateRule()` du moteur de règles,
  rétro-compatible strict (string = égalité).

## Invariant
- Défaut OFF ⇒ byte-identique (assert par test). `git add` fichier par fichier. Aucun push.

## Journal
(rempli au fil de l'implémentation)

## Résultats (2026-09-05)

### Phase 1 — `src/sensory/system-vitals-emitter.ts` (nouveau) + câblage `src/server/index.ts`
- `runSystemVitalsPass(deps)` : passe pure/testable, injection façon `episodic-journal.ts`.
  Lecteurs injectables (défauts entre parenthèses) : `readMemory` (process.memoryUsage),
  `readLoad` (os.loadavg), `readGpu` (gpu-monitor `getGPUMonitor().getStats`), `readFleet`
  (fleet-load `getFleetLoad`/`isFleetSaturated`), `readDisk` (disk-guard `getFreeSpaceInfo`),
  `readChildren` (`ps -eo pid,ppid,pcpu,etimes,comm` filtré aux descendants du serveur).
  Aucune nouvelle logique de mesure.
- Garde « processus emballé » : compteur interne par pid ; émet `process_runaway` après
  `CODEBUDDY_RUNAWAY_PASSES` (défaut 3) passes CONSÉCUTIVES au-dessus de
  `CODEBUDDY_RUNAWAY_CPU_PCT` (défaut 90). Une passe sous le seuil réinitialise le compteur ;
  les pids disparus sont purgés. C'est le correctif de l'incident du 05/09.
- Émissions : `resource_threshold` (pouls portant tout le snapshot, cible des seuils de règles),
  `disk_low` (>= `CODEBUDDY_DISK_LOW_PCT`, défaut 90 ; `diskPct` = % UTILISÉ), `fleet_saturated`,
  `process_runaway`. Émission DIRECTE sur le bus `getGlobalEventBus().emit('sensory:perception', …)`
  (jamais via le bridge WS). never-throws de bout en bout.
- Câblé dans `src/server/index.ts` après le bloc `dreaming` : traitement de battement
  `system-vitals`, opt-in `CODEBUDDY_SYSTEM_VITALS==='true'`, cadence
  `CODEBUDDY_SYSTEM_VITALS_EVERY` (défaut 30), `heart.unregister` poussé dans `sensoryTeardown`.
  Le verrou `inFlight` du scheduler garantit le non-chevauchement — pas de boucle.

### Phase 2 — opérateurs de seuil dans `src/sensory/sensory-rules-engine.ts`
- `SensoryRule.match.filters` accepte `Record<string, string | {op:'gt'|'gte'|'lt'|'lte'|'eq'|'ne', value:number}>`.
- `ruleMatches()` délègue à `filterMatches()` : string = égalité exacte (INCHANGÉ, byte-identique) ;
  objet = comparaison numérique sur `payload[clé]` coercé en nombre (non numérique ⇒ false).
- `validateRule()` valide la nouvelle forme (opérateur inconnu / valeur non numérique / filters
  non-objet rejetés). Helpers exportés `isNumericFilter`, `filterMatches` (+ `__test`).

### Preuves
- `HOME=<isolé> npx vitest run tests/sensory/system-vitals-emitter.test.ts tests/sensory/sensory-rules-engine.test.ts`
  ⇒ **2 fichiers, 23 tests verts** (12 émetteur + 11 règles).
- Suite sensory complète : **avant** 73 fichiers / 682 tests ; **après** 75 fichiers / 705 tests
  (74 passés + 1 skipped ; 700 passés, 4 skipped, 1 todo). Delta = exactement mes 23 tests neufs,
  zéro test existant modifié. Les 5 fichiers de tests règles pré-existants passent (non-régression).
- `npx tsc --noEmit -p .` : code 0. ESLint ciblé (fichiers touchés) : code 0. `git diff --check` : code 0.
- Byte-identique : test (e) — flag off ⇒ aucun percept sur le bus ; une passe entièrement injectée
  n'atteint jamais le bus global (émet via l'`emit` injecté). String filter = égalité inchangée.

### Reste (hors périmètre de cette mission — Phases 3-5)
- Phase 3 : `schedule-emitter` (tick horaire autonome, `CODEBUDDY_SCHEDULE_TICKS`).
- Phase 4 : pont des événements de domaine (`fleet:activity`, `agent:loop_detected`, `cost:*`,
  `context:pre_compact`) vers le bus sensoriel.
- Phase 5 : règles-modèles livrées + `buddy rules add --template` + docs (`docs/` + tableau env `CLAUDE.md`).

### Commits (fichier par fichier, aucun push)
1. `docs(heartwatch)` — réservation + rapport.
2. `feat(sensory)` Phase 1 — émetteur + câblage serveur + test.
3. `feat(sensory)` Phase 2 — opérateurs de seuil + test.
4. `test(sensory)` — assertion byte-identique.

## Phases 3 & 5 (2026-09-05, même session)

### Phase 3 — `src/sensory/schedule-emitter.ts` (nouveau) + câblage serveur
- `runSchedulePass(deps)` : passe pure/testable, horloge + emit injectables. Émet UN percept
  `time/tick` par passe (`getGlobalEventBus().emit('sensory:perception', { source:'schedule',
  metadata:{ modality:'time', kind:'tick', salience:1, payload:{ hhmm, weekday, iso, minuteOfDay } } })`).
  Patron reminder-runner (lire l'horloge, agir une fois) mais SANS boucle. never-throws (retourne null).
- Câblé dans `src/server/index.ts` après system-vitals : traitement `schedule-ticks`, opt-in
  `CODEBUDDY_SCHEDULE_TICKS`, cadence `CODEBUDDY_SCHEDULE_TICKS_EVERY` (défaut 60 ≈ 1/min), teardown poussé.
- Permet des règles à l'heure (`match.kind:'tick'` + `between`/`filters` sur `hhmm`) sans boucle occupée.

### Phase 5 — règles-modèles + CLI + docs
- `src/sensory/rule-templates.ts` (nouveau) : 4 modèles VALIDÉS par `validateRule`, non actifs tant
  que non installés — `process-runaway-alert` (correctif incident), `disk-low-alert`
  (`filters:{diskPct:{op:gte,value:90}}`), `fleet-saturated-alert`, `codex-quota-probe` (tick 04:20 → agent).
  Actions conservatrices (alert/agent lecture) — aucun auto-kill livré.
- CLI (`src/index.ts`, commande `rules`) : `buddy rules templates` liste, `buddy rules add --template
  <nom>` installe via `upsertSensoryRule` APRÈS `validateRule`. Vérifié de bout en bout (tsx, HOME isolé) :
  install → list → validate → JSON écrit correct.
- Docs : `docs/surveillance-evenementielle.md` (flux battement→percept→règle→action + activation +
  install + tableau des flags) ; pointeur ajouté à `docs/companion-guide.md` ; 3 lignes env ajoutées au
  tableau de `CLAUDE.md` (`CODEBUDDY_SYSTEM_VITALS`/`_EVERY`, `RUNAWAY_CPU_PCT`/`PASSES`,
  `SCHEDULE_TICKS`/`_EVERY`).

### Preuves (Phases 3 & 5)
- `HOME=<isolé> npx vitest run tests/sensory/schedule-emitter.test.ts tests/sensory/rule-templates.test.ts`
  ⇒ **2 fichiers, 12 tests verts** (5 horaire + 7 templates).
- Suite sensory complète : **avant P3&P5** 75 fichiers / 705 tests ; **après** 77 fichiers / 717 tests
  (76 passés + 1 skipped ; 712 passés, 4 skipped, 1 todo). Delta = exactement mes 12 tests neufs, zéro
  test existant modifié.
- `npx tsc --noEmit -p .` code 0. ESLint ciblé (8 fichiers touchés) code 0. `git diff --check` code 0.
- Byte-identique : flags off ⇒ traitements non enregistrés ; passes entièrement injectées n'atteignent
  jamais le bus global (assert par test).

### Commande exacte pour installer la règle anti-emballement
```
buddy rules add --template process-runaway-alert
```
(à faire une fois ; puis lancer le serveur avec `CODEBUDDY_SYSTEM_VITALS=true CODEBUDDY_SENSORY_RULES=true
CODEBUDDY_SENSORY_TOKEN=<token> buddy server`).

### Reste (hors périmètre — Phase 4)
- Phase 4 : pont des événements de domaine déjà sur le bus (`fleet:activity`, `agent:loop_detected`,
  `cost:*`, `context:pre_compact`) ré-émis en percepts sensoriels, pour qu'une seule grammaire de règles
  couvre perception physique ET vie interne de l'agent.

### Commits Phases 3 & 5 (fichier par fichier, aucun push)
5. `feat(sensory)` Phase 3 — schedule-emitter + câblage + test.
6. `feat(sensory)` Phase 5 — rule-templates + CLI + test.
7. `docs(sensory)` Phase 5 — guide + companion-guide + CLAUDE.md.

## Phase 4 + correctif portée (2026-09-05, même session)

### Phase 4 — `src/sensory/domain-event-bridge.ts` (nouveau) + câblage + template
- `wireDomainEventBridge(): () => void` (contrat `reactions.ts`) : s'abonne aux événements de
  domaine DÉJÀ sur le bus et les ré-émet en percepts sensoriels internes tagués
  `source:'domain-bridge'` — `fleet:activity → fleet/activity`, `agent:loop_detected →
  agent/loop_detected`, `cost:updated|warning|limit_reached → agent/cost_<subtype>`,
  `context:pre_compact → agent/context_pre_compact`. Une SEULE grammaire de règles couvre
  perception physique ET vie interne de l'agent.
- **Anti-boucle impératif** : n'écoute JAMAIS `sensory:perception` + garde de marqueur de source
  (un percept ré-émis, tagué `domain-bridge`, ne peut jamais retrigger le pont). Prouvé par test.
- Câblé opt-in `CODEBUDDY_DOMAIN_EVENTS`, teardown poussé. never-throws.
- Nouveau template `agent-loop-alert` (`modality:agent, kind:loop_detected → alert`).

### Correctif IMPORTANT — portée de scan runaway (server|user) + exceptions comm
Vérification : la garde ne descendait que dans l'arbre de `process.pid` (descendants du serveur).
L'incident du 05/09 était dans un AUTRE arbre (boucles enfants de la session `claude`), donc la
garde NE L'AURAIT PAS attrapé.
- `CODEBUDDY_RUNAWAY_SCOPE` = `server` (défaut, inchangé) | `user` (tous les processus de l'uid,
  `ps -u <uid>`). Même logique (seuil + N passes + purge) sur un scope élargi.
- `CODEBUDDY_RUNAWAY_IGNORE_COMM` (csv, défauts ffmpeg/comfyui/python/python3/node/tsc/vitest/
  cargo/rustc/esbuild, match exact ou préfixe) : un `comm` de la liste n'émet JAMAIS `process_runaway`.
  Indispensable en mode `user`.
- Payload `process_runaway` enrichi : `pid`, `ppid`, `comm`, `pcpu`, `etimeSec`, `scope`.
- **Avec `CODEBUDDY_RUNAWAY_SCOPE=user`, l'incident du 05/09 aurait été détecté et alerté.**

### Preuves (Phase 4 + correctif)
- `tests/sensory/domain-event-bridge.test.ts` : **9 tests verts** — (a) chaque type de domaine → percept
  correspondant, (b) PAS de boucle (émettre un `sensory:perception` ne déclenche aucune ré-émission ;
  garde de marqueur de source ; 10 émissions restent linéaires), (c) flag off = aucun abonnement.
- `tests/sensory/system-vitals-emitter.test.ts` : 12 → **17 tests** (+5) — (a) scope:user attrape un runaway
  HORS de l'arbre du serveur, (b) comm ignoré (ffmpeg / préfixe python3 / env custom) jamais émis,
  (c) scope:server par défaut inchangé.
- Suite sensory complète : **78 fichiers / 731 tests** (77 passés + 1 skipped ; 726 passés, 4 skipped,
  1 todo). `npx tsc --noEmit -p .` 0, ESLint ciblé 0, `git diff --check` 0.

## Bilan final — les 4 phases livrées

| Phase | Livré | Fichier(s) clés | Flag |
| --- | --- | --- | --- |
| 1 | Émetteur signes vitaux système + garde processus emballé | `src/sensory/system-vitals-emitter.ts` | `CODEBUDDY_SYSTEM_VITALS` |
| 2 | Opérateurs de seuil numériques dans les règles | `src/sensory/sensory-rules-engine.ts` | (aucun — rétro-compatible) |
| 3 | Déclencheur horaire autonome (`time/tick`) | `src/sensory/schedule-emitter.ts` | `CODEBUDDY_SCHEDULE_TICKS` |
| 4 | Pont des événements de domaine → bus sensoriel | `src/sensory/domain-event-bridge.ts` | `CODEBUDDY_DOMAIN_EVENTS` |
| 5 | Règles-modèles + `buddy rules templates\|add --template` + docs | `src/sensory/rule-templates.ts`, `src/index.ts`, `docs/surveillance-evenementielle.md` | (install à la demande) |

- **Tests neufs de toute la mission** : 5 fichiers, **49 tests** (system-vitals 17, seuils 11, tick 5,
  templates 7, pont 9). Suite sensory : 682 → 731 tests (73 → 78 fichiers), zéro test existant cassé.
- **La grammaire de règles couvre désormais physique (caméra/micro/écran + système) ET interne
  (flotte, boucles agent, coût, compaction)** — un seul `sensory-rules.json`, un seul moteur.
- **Tout opt-in, défaut OFF, byte-identique sans les flags** (assert par test), never-throws.
- **Reste** : rien du plan initial (Phases 1-5 faites). Extension future possible : battement TS de
  repli (`setInterval`) quand le daemon Rust est absent (mentionnée en portée/limites du plan).

### Commande exacte pour armer le correctif de l'incident
```
buddy rules add --template process-runaway-alert
CODEBUDDY_SENSORY=true CODEBUDDY_SYSTEM_VITALS=true CODEBUDDY_RUNAWAY_SCOPE=user \
CODEBUDDY_SENSORY_RULES=true CODEBUDDY_SENSORY_TOKEN=<token> buddy server
```
