# Réparation GF2 — régressions de fusion

Rapport initialisé avant toute inspection du dépôt le 2026-09-03.

## Cadre et baseline

- Clone : `/home/patrice/DEV/cb-succes-registry-2026-09-02`.
- Branche : `fix/gf2-regressions-fusions-2026-09-03`.
- Base GF1 : `5323b00d2` ; réservation : `48a0f4889`.
- Temporaires de test confinés sous `node_modules/.gf2/{home,tmp}`.
- Travaux sales préexistants laissés intacts : `.codebuddy/agent-memory/alice/MEMORY.md`,
  `_qa/gk10/home/`, trois lecteurs factices `_qa/gk23/bin/`, `branch/`, `feature-branch/`.

Baseline imposé :

```text
HOME="$PWD/node_modules/.gf2/home" TMPDIR="$PWD/node_modules/.gf2/tmp" \
  npx vitest run tests/fusion/revue-gf1-fusions.test.ts
Test Files 1 failed (1)
Tests 6 failed | 2 passed (8)
```

## Régression 1 — SENSE7 × GT2, réponses brèves prises pour l'écho

Intentions conservées : SENSE7 reconnaît les fragments acoustiques contigus de 1 à 3 mots et GT2
les fragments entièrement composés de tokens robot ; SENSE3/GT2 laisse cependant les réponses
conversationnelles bornées atteindre la fenêtre d'engagement. Une seule définition
`isBriefConversationAnswer` est désormais partagée par le décideur et le filtre d'écho.

Le test GF1 annonçait « oui, non, merci » mais n'exerçait que « oui » : il a été renforcé sans
changer l'attente `distinct`.

```text
ROUGE — npx vitest run tests/fusion/revue-gf1-fusions.test.ts -t "réponse humaine normale"
Tests 1 failed | 7 skipped (8) — oui: expected 'echo' to be 'distinct'

VERT — test GF1 ciblé : 1 passed | 7 skipped ; voisins
`voice-activity` + `revue-gt1-mutations` + `respond-decider` : 3 fichiers, 60 tests passés.
```

## Vérifications finales

À compléter.

## Grille régression → correctif → commit

À compléter.
