# Réparation SENSE1 — écho vocal et faux mouvements

## Cadre

- Mission : corriger la réinjection de la voix synthétique dans le STT, les faux mouvements dans le noir, l'hystérésis de présence et la limitation des analyses visuelles.
- Branche demandée : `fix/robot-echo-mouvement-2026-09-03`.
- Contraintes : aucun push, aucune API payante, aucun service système touché, aucune écriture hors de ce clone ni dans `~/.codebuddy`, aucun accès au dépôt original interdit, aucune donnée personnelle dans le code ou les tests.

## Journal chronologique

1. Rapport créé avant toute inspection du dépôt.
   - Action : création de `REPARATION-SENSE1.md` avec `apply_patch`.
   - Résultat : rapport initialisé.
2. Faits mesurés lus intégralement avant inspection du clone.
   - Commande : `cat /home/patrice/DEV/vitrine-drafts/vague-2026-09-02/robot/FAITS-ROBOT-ECHO-MOUVEMENT-2026-09-02.md`.
   - Résultat : causes confirmées — confiance indue dans `aecActive`, bruit sombre au-dessus du seuil de mouvement, pertes de visage de 2 à 6 s et journal STT répété.
3. Coordination lue intégralement par tranches, puis état du clone contrôlé.
   - Commandes : `cat docs/FABLE5-CODEX-COORDINATION.md`, lectures intégrales par tranches avec `dd`, `git status --short --branch`, `git branch --show-current`, `git log -1 --oneline`.
   - Résultat : branche demandée déjà active ; seul le présent rapport était non suivi ; base `facea9864`.
4. Chantier réservé dans `docs/FABLE5-CODEX-COORDINATION.md` avant toute modification du code ou des tests.
5. Cartographie ciblée de la voix et de la vision réalisée avec `rg`; lecture des implémentations et tests de proximité avant le premier test.

## Fichiers lus

- `/home/patrice/DEV/vitrine-drafts/vague-2026-09-02/robot/FAITS-ROBOT-ECHO-MOUVEMENT-2026-09-02.md` (source imposée, lecture seule hors clone)
- `docs/FABLE5-CODEX-COORDINATION.md`
- `CLAUDE.md` (section sensorielle et variables voix/vision)
- `src/sensory/voice-activity.ts`
- `src/sensory/speech-reaction.ts` (garde, barge-in, transcription et ingestion)
- `src/sensory/voice-loop.ts` (sites qui enregistrent le texte envoyé au TTS, repérés par recherche)
- `tests/sensory/speech-reaction.test.ts`
- `tests/sensory/voice-activity.test.ts`
- `src/sensory/semantic-vision-reaction.ts` (sites de présence repérés par recherche)
- `src/sensory/vision-reaction.ts` (sites d'analyse repérés par recherche)
- `tests/sensory/arrival-greeting.test.ts` (cas d'accueil repérés par recherche)
- `tests/sensory/vision-reaction.test.ts` (cas d'analyse repérés par recherche)
- `buddy-vision/watch.py` (constantes et chemins mouvement/présence repérés par recherche)
- `buddy-vision/test_watch.py` (tests mouvement/présence repérés par recherche)

## Correctif 1 — garde demi-duplex

### Test rouge

Commande :

```text
npx vitest run tests/sensory/speech-reaction.test.ts -t "keeps the half-duplex guard closed when AEC is announced but not explicitly trusted"
```

Sortie rouge utile (après `npm ci --ignore-scripts --no-audit --no-fund`, la première tentative n'ayant pas atteint les tests faute de dépendances dans le clone) :

```text
FAIL tests/sensory/speech-reaction.test.ts > ... > keeps the half-duplex guard closed when AEC is announced but not explicitly trusted
AssertionError: expected [ 'résidu du haut-parleur', …(1) ] to deeply equal [ 'Lisa, vraie question humaine' ]
- Expected
+ Received
  [
+   "résidu du haut-parleur",
    "Lisa, vraie question humaine",
  ]
Test Files  1 failed (1)
Tests  1 failed | 45 skipped (46)
EXIT_CODE=1
```

### Test vert

Commandes et sorties :

```text
npx vitest run tests/sensory/speech-reaction.test.ts -t "keeps the half-duplex guard closed when AEC is announced but not explicitly trusted"
Test Files  1 passed (1)
Tests  1 passed | 45 skipped (46)
EXIT_CODE=0

npx vitest run tests/sensory/speech-reaction.test.ts tests/sensory/voice-activity.test.ts
Test Files  2 passed (2)
Tests  52 passed (52)
EXIT_CODE=0
```

Implémentation : `aecActive` ne contourne la garde que si `CODEBUDDY_SENSORY_AEC_TRUST=true`; la même porte protège le barge-in naturel AEC. La queue d'écho reste fermée par défaut. Variable documentée dans `CLAUDE.md` avec défaut `false`.

### Commit

`a9056300a` — `fix(sensory): require explicit trust for AEC bypass`.

## Correctif 2 — filtre de propre écho

### Test rouge

Commande :

```text
npx vitest run tests/sensory/speech-reaction.test.ts -t "drops the four measured robot phrases as own echo for 90 seconds without relying on AEC"
```

Sortie rouge utile :

```text
FAIL tests/sensory/speech-reaction.test.ts > ... > drops the four measured robot phrases as own echo for 90 seconds without relying on AEC
AssertionError: expected [] to have a length of 1 but got +0
- Expected
+ Received
- 1
+ 0
Test Files  1 failed (1)
Tests  1 failed | 46 skipped (47)
EXIT_CODE=1
```

Le test exerce les quatre phrases sans donnée personnelle issues du Fait 1, à 89,999 s, avec `aecActive: false`, et attend le journal exact `[speech] dropped own echo`.

### Test vert

Commandes et sorties :

```text
npx vitest run tests/sensory/speech-reaction.test.ts -t "drops the four measured robot phrases as own echo for 90 seconds without relying on AEC"
Test Files  1 passed (1)
Tests  1 passed | 46 skipped (47)
EXIT_CODE=0

npx vitest run tests/sensory/speech-reaction.test.ts tests/sensory/voice-activity.test.ts
Test Files  2 passed (2)
Tests  54 passed (54)
EXIT_CODE=0
```

Implémentation : anneau mémoire de 8 phrases effectivement envoyées au TTS, fenêtre 90 s, normalisation casse/accents/ponctuation, détection par sous-chaîne ou couverture d'au moins 60 % des mots de la phrase prononcée. Le rejet intervient avant toute décision ou mémoire et journalise exactement `[speech] dropped own echo`, sans dépendre de l'AEC ni de l'état de playback.

### Commit

`3af9d4155` — `fix(sensory): drop recent spoken phrases from STT`.

## Correctif 3 — porte de mouvement de l'œil

### Test rouge

Commande :

```text
cd buddy-vision
python3 -m unittest test_watch.py
```

Sortie rouge utile :

```text
ImportError: cannot import name 'MotionGate' from 'watch'
Ran 1 test in 0.000s
FAILED (errors=1)
EXIT_CODE=1
```

Les nouveaux tests construisent vingt images de bruit gaussien sombre (aucun événement, journal d'obscurité au plus une fois) puis un rectangle clair en déplacement (exactement un événement).

### Test vert

Commande et sortie :

```text
cd buddy-vision
python3 -m unittest test_watch.py
..................
Ran 18 tests in 0.140s
OK
EXIT_CODE=0
```

Implémentation : score sur images 5×5 floutées = fraction des pixels dont `absdiff > 25`; médiane glissante des scores stables et seuil `max(BUDDY_VISION_MOTION, 2.5 × noiseFloor)`; obscurité sous `BUDDY_VISION_MIN_LUMA=12` sans événement et journal au plus une fois par minute. Les événements `motion` portent désormais `meanLuma` et `noiseFloor`.

### Commit

`bf4c6a4ae` — `fix(vision): reject dark sensor noise as motion`.

## Correctif 4 — hystérésis de présence

### Test rouge

Commandes et sorties rouges :

```text
cd buddy-vision
python3 -m unittest test_watch.AnonymousMultiTrackerTests.test_total_detector_loss_is_delayed_and_reacquisition_keeps_episode
TypeError: AnonymousMultiTracker.__init__() got an unexpected keyword argument 'lost_secs'
Ran 1 test in 0.001s
FAILED (errors=1)
EXIT_CODE=1

npx vitest run tests/sensory/arrival-greeting.test.ts -t "keeps a loss and reappearance inside five minutes in one greeting episode"
AssertionError: expected "vi.fn()" to be called 1 times, but got 2 times
Test Files  1 failed (1)
Tests  1 failed | 6 skipped (7)
EXIT_CODE=1
```

Le premier test exige une perte seulement après 20 s sans détection et conserve l'identifiant d'épisode lors d'une réacquisition. Le second reproduit entrée → perte 2 s plus tard → réapparition 120 s plus tard et prouve le double accueil actuel.

### Test vert

Commandes et sorties :

```text
cd buddy-vision
python3 -m unittest test_watch.AnonymousMultiTrackerTests.test_total_detector_loss_is_delayed_and_reacquisition_keeps_episode
Ran 1 test in 0.000s
OK
EXIT_CODE=0

npx vitest run tests/sensory/arrival-greeting.test.ts -t "keeps a loss and reappearance inside five minutes in one greeting episode"
Test Files  1 passed (1)
Tests  1 passed | 6 skipped (7)
EXIT_CODE=0

python3 -m unittest test_watch.py
Ran 18 tests in 0.037s
OK
EXIT_CODE=0

npx vitest run tests/sensory/arrival-greeting.test.ts
Test Files  1 passed (1)
Tests  7 passed (7)
EXIT_CODE=0
```

Implémentation : expiration des pistes par temps monotone avec `BUDDY_VISION_PERSON_LOST_SECS=20` au lieu d'un nombre d'images dépendant du FPS; côté cerveau, `CODEBUDDY_SENSORY_REGREET_MIN_MS=300000` rattache la réapparition au même épisode, y compris si une identification locale suit l'entrée.

### Commit

`2f66e2cf3` — `fix(vision): add presence episode hysteresis`.

## Correctif 5 — garde-fous du cerveau visuel

### Test rouge

Commande :

```text
npx vitest run tests/sensory/vision-reaction.test.ts -t "skips a motion keyframe|caps ten motion events"
```

Sortie rouge utile :

```text
FAIL ... > skips a motion keyframe whose payload reports darkness
AssertionError: expected 1 to be +0
- 0
+ 1

FAIL ... > caps ten motion events in ten seconds to four analyses
AssertionError: expected 10 to be less than or equal to 4
Test Files  1 failed (1)
Tests  2 failed | 11 skipped (13)
EXIT_CODE=1
```

### Test vert

Commandes et sorties :

```text
npx vitest run tests/sensory/vision-reaction.test.ts -t "skips a motion keyframe|caps ten motion events"
Test Files  1 passed (1)
Tests  2 passed | 11 skipped (13)
EXIT_CODE=0

npx vitest run tests/sensory/vision-reaction.test.ts
Test Files  1 passed (1)
Tests  13 passed (13)
EXIT_CODE=0
```

Implémentation : rejet immédiat et journalisé des charges utiles `meanLuma < 12`; fenêtre glissante de 60 s comptant les appels réels à l'analyseur et plafonnée par `CODEBUDDY_VISION_MAX_ANALYSES_PER_MIN=4`; les appels refusés journalisent la cause.

### Commit

`26d52a975` — `fix(vision): bound dark-frame analyses`.

## Bonus — journal STT de repli unique

### Test rouge

```text
npx vitest run tests/sensory/sherpa-rs-stt.test.ts -t "logs the same language-pin fallback only once per process"
TypeError: warnSpeechFallbackOnce is not a function
Test Files  1 failed (1)
Tests  1 failed | 3 skipped (4)
EXIT_CODE=1
```

### Test vert

```text
npx vitest run tests/sensory/sherpa-rs-stt.test.ts -t "logs the same language-pin fallback only once per process"
Test Files  1 passed (1)
Tests  1 passed | 3 skipped (4)
EXIT_CODE=0

npx vitest run tests/sensory/sherpa-rs-stt.test.ts tests/sensory/speech-engine-config.test.ts
Test Files  2 passed (2)
Tests  8 passed | 1 skipped (9)
EXIT_CODE=0
```

La cause `parakeet-language-pin-unsupported` est mémorisée en processus; toute répétition du même repli, même si le contexte d'appel varie, ne rejournalise pas l'avertissement.

### Commit

`29656429e` — `fix(sensory): log STT fallback once per process`.

## Vérifications finales

Toutes les vérifications ci-dessous ont été exécutées au sommet fonctionnel `29656429e`, sans API ni matériel externe :

```text
npx vitest run tests/sensory/speech-reaction.test.ts tests/sensory/voice-activity.test.ts tests/sensory/sherpa-rs-stt.test.ts tests/sensory/speech-engine-config.test.ts tests/sensory/arrival-greeting.test.ts tests/sensory/vision-reaction.test.ts
Test Files  6 passed (6)
Tests  82 passed | 1 skipped (83)
EXIT_CODE=0

cd buddy-vision && python3 -m unittest test_watch.py
..................
Ran 18 tests in 0.025s
OK
EXIT_CODE=0

cd buddy-vision && python3 -m py_compile watch.py test_watch.py
EXIT_CODE=0

npm run typecheck
tsc --noEmit && npm run typecheck:gpuNode-identity
tsc --project tsconfig.gpuNode-identity.json
EXIT_CODE=0

npx eslint src/sensory/speech-reaction.ts src/sensory/voice-activity.ts src/sensory/semantic-vision-reaction.ts src/sensory/vision-reaction.ts tests/sensory/speech-reaction.test.ts tests/sensory/voice-activity.test.ts tests/sensory/sherpa-rs-stt.test.ts tests/sensory/arrival-greeting.test.ts tests/sensory/vision-reaction.test.ts
(aucune sortie)
EXIT_CODE=0

npm run lint
✖ 2466 problems (0 errors, 2466 warnings)
EXIT_CODE=0

npx vitest run tests/security/donnees-personnelles.test.ts
Test Files  1 passed (1)
Tests  1 passed (1)
EXIT_CODE=0
```

Le test ignoré est le test STT dépendant d'un modèle/matériel réel déjà conditionnel. Le lint global conserve 2 466 avertissements préexistants hors périmètre mais ne produit aucune erreur; le lint strictement ciblé est silencieux. `git diff --check` sera rejoué après la clôture documentaire. Aucun service n'a été touché, aucune API appelée, aucun push effectué et aucune écriture réalisée hors du clone.

## Variables à copier dans `vision.env`

Valeurs par défaut explicites des nouvelles portes, plus le seuil de mouvement existant conservé comme base du seuil adaptatif :

```dotenv
CODEBUDDY_SENSORY_AEC_TRUST=false
BUDDY_VISION_MOTION=0.02
BUDDY_VISION_MIN_LUMA=12
BUDDY_VISION_NOISE_WINDOW=120
BUDDY_VISION_PERSON_LOST_SECS=20
CODEBUDDY_SENSORY_REGREET_MIN_MS=300000
CODEBUDDY_VISION_MAX_ANALYSES_PER_MIN=4
```

`BUDDY_VISION_MOTION` n'est pas nouvelle : sa valeur reste `0.02`, désormais utilisée dans `max(BUDDY_VISION_MOTION, 2.5 × noiseFloor)`. Les six autres lignes sont les variables ajoutées par cette mission.
