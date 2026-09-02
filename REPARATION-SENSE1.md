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

Prévu : `fix(sensory): drop recent spoken phrases from STT`.

## Correctif 3 — porte de mouvement de l'œil

### Test rouge

_À compléter._

### Test vert

_À compléter._

### Commit

_À compléter._

## Correctif 4 — hystérésis de présence

### Test rouge

_À compléter._

### Test vert

_À compléter._

### Commit

_À compléter._

## Correctif 5 — garde-fous du cerveau visuel

### Test rouge

_À compléter._

### Test vert

_À compléter._

### Commit

_À compléter._

## Vérifications finales

_À compléter._

## Variables à copier dans `vision.env`

_À compléter en fin de mission._
