# Réparation SENSE3

## Journal

- 2026-09-02 — Rapport créé avant toute inspection du dépôt. Mission SENSE3 démarrée ; aucune lecture, modification fonctionnelle, vérification ou commit effectué à ce stade.
- 2026-09-02 — `docs/FABLE5-CODEX-COORDINATION.md` lu (protocole, tableau, flotte, décisions et journal de passation) ; réservation SENSE3 ajoutée pour Codex (GPT-5), branche `fix/sense-gemini-2026-09-03`, base `f65817c9`.

## Fichiers lus

- `docs/FABLE5-CODEX-COORDINATION.md` — lecture complète avant la réservation ; zones gelées et garde-fous relevés.
- `REVUE-SENSE-GEMINI.md` — 382 lignes lues intégralement ; grille §4, traces §5, vérifications §6 et commits §7 relevés.
- Périmètre lu et signalé par la revue : `buddy-sense/src/bridge.rs`, `buddy-sense/src/bus.rs`, `buddy-sense/src/senses/audio.rs`, `buddy-sense/src/senses/live_audio.rs`, `buddy-vision/watch.py` (lecture seule, gelé), `src/sensory/speech-reaction.ts`, `src/sensory/respond-decider.ts`, `src/sensory/voice-activity.ts`, `src/sensory/vision-reaction.ts`, `src/sensory/semantic-vision-reaction.ts`, `src/sensory/arrival-opener.ts`, `src/sensory/reactions.ts`, `src/sensory/dreaming.ts`, `src/companion/presence-loop.ts`, `src/companion/proactive-engine.ts`, `src/companion/orchestrator.ts`, `src/companion/impulses.ts`, `src/companion/idle-loop.ts`, `src/companion/dialogue-percepts.ts`.

## Vérifications

### Rouge initial fourni par la revue

- Trou 1 (ambient-in-window), `./node_modules/.bin/vitest run tests/sensory/hole-ambient-in-window-loop.test.ts` : `FAIL` — `expected true to be false` sur la réponse, puis sur `snapshotAfter.engaged` ; la question ambiante est classée `engaged` et réarme la fenêtre.
- Trou 2 (conductor), `./node_modules/.bin/vitest run tests/sensory/hole-arrival-conductor-race.test.ts` : `FAIL` — `expected "vi.fn()" to not be called at all, but actually been called 1 times`; l'assertion `expect(greet).not.toHaveBeenCalled()` échoue.
- Trou 3 (politique Maison), `./node_modules/.bin/vitest run tests/sensory/hole-arrival-home-policy.test.ts` : `FAIL` — `expected "vi.fn()" to not be called at all, but actually been called 1 times`; l'assertion `expect(greet).not.toHaveBeenCalled()` échoue.
- Trou 4 (collision voix), `./node_modules/.bin/vitest run tests/sensory/hole-arrival-voice-collision.test.ts` : `FAIL` — `expected "vi.fn()" to not be called at all, but actually been called 1 times`; l'assertion `expect(greet).not.toHaveBeenCalled()` échoue.
- Trou 5 (mémoire), `./node_modules/.bin/vitest run tests/sensory/hole-dreaming-hallucination-memory.test.ts` : `FAIL` — la mémoire contient `vision/scene_described` sous `dream:recent`, alors que le test exige son absence.
- Trou 6 (VAD), `./node_modules/.bin/vitest run tests/sensory/hole-vad-noise-cap.test.ts` : `FAIL` — `expected 'cap' to be 'silence'`; le hard-cap est renvoyé au lieu d'une clôture silence.
- Test 7 (hors périmètre), `pytest buddy-vision/test_hole_dark_motion_threshold.py` : `FAIL`, score sombre `0.0265 >= seuil 0.02`. Test et fichier explicitement gelés, aucune modification prévue dans cette mission.

Les sorties ci-dessus sont la trace rouge consignée par la revue Gemini ; le rejeu local sera ajouté avant chaque correctif quand il sera effectué.

### Rejeu rouge local avant correctif

Commandes exécutées avec `HOME` et `TMPDIR` redirigés vers `.sense3-runtime/` dans le clone :

- Trou 1 — exit 1, `2 tests | 2 failed` : `expected true to be false` sur la réponse et sur `snapshotAfter.engaged`.
- Trou 2 — exit 1, `1 test | 1 failed` : `expected "vi.fn()" to not be called at all, but actually been called 1 times`.
- Trou 3 — exit 1, `1 test | 1 failed` : `expected "vi.fn()" to not be called at all, but actually been called 1 times`.
- Trou 4 — exit 1, `1 test | 1 failed` : `expected "vi.fn()" to not be called at all, but actually been called 1 times`.
- Trou 5 — exit 1, `1 test | 1 failed` : la mémoire générée contient `vision/scene_described` sous `dream:recent`.
- Trou 6 — exit 1, `1 test | 1 failed` : `expected 'cap' to be 'silence'` (`Expected: "silence"`, `Received: "cap"`).

Installation nécessaire au rejeu : `npm ci --ignore-scripts` dans le clone, exit 0 (`added 1848 packages`; npm signale 48 vulnérabilités de dépendances existantes, aucune commande d’audit correctif lancée). Aucun service ni fichier hors clone touché.

### Trou 1 — ambient-in-window et écho propre

- Correctif : `respond-decider.ts` ne classe plus une question nue ou un préfixe de continuation comme suivi dirigé ; une demande explicite, une adresse par nom et les réponses de salutation/check-in étroites restent admises. L’extension de fenêtre ne se fait plus sur le simple cas ambient. `speech-reaction.ts` compare désormais toute transcription à la dernière phrase vocalisée, supprime un recouvrement d’au moins 60 % et journalise exactement `[speech] dropped own echo`. `voice-activity.ts` retient seulement la référence la plus récente et utilise le nombre de mots de cette phrase comme dénominateur.
- Tests voisins adaptés au contrat explicite : les anciens scénarios « `et … ?` suffit » vérifient maintenant une demande directe, sans élargir le comportement.
- Vert local : `./node_modules/.bin/vitest run tests/sensory/hole-ambient-in-window-loop.test.ts tests/sensory/respond-decider.test.ts tests/sensory/voice-activity.test.ts tests/sensory/speech-reaction.test.ts` → `Test Files 4 passed (4)`, `Tests 94 passed (94)` ; `git diff --check` vert.
- Commit réalisé : `bd3b91690` — `fix(sensory): close ambient engagement and own echo loop`.

### Trou 2 — accueil vidéo et chef d’orchestre

- Rouge local : `./node_modules/.bin/vitest run tests/sensory/hole-arrival-conductor-race.test.ts` → exit 1, `1 test | 1 failed`, l’accueil appelait `greet` malgré une claim `presence` cinq secondes plus tôt.
- Correctif : `wireSemanticVisionReaction` consulte le conducteur compagnon partagé et ne consomme le cooldown local qu’après `conductor.claim('arrival')`. Les tests d’accueil existants injectent un conducteur à horloge simulée afin de conserver leur déterminisme.
- Vert local : `./node_modules/.bin/vitest run tests/sensory/hole-arrival-conductor-race.test.ts tests/sensory/arrival-greeting.test.ts tests/companion/orchestrator.test.ts` → `Test Files 3 passed (3)`, `Tests 10 passed (10)`.
- Commit à créer : `fix(sensory): arbitrate arrival greetings with conductor`.

## Commits

_À compléter au fil de l’eau._
