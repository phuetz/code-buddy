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

## Régression 2 — SENSE1 × CONV2, demi-duplex et transitoires acoustiques

SENSE1 impose que `aecActive` ne contourne jamais le demi-duplex sans
`CODEBUDDY_SENSORY_AEC_TRUST=true`. CONV2/SENSE7 conserve le barge-in naturel, mais seulement
pour une parole soutenue (250 ms) dépassant la marge de fuite. Les deux chemins
`speech_start`/adaptatif utilisent maintenant la même évaluation de confiance et de durée ; les
lectures oubliées de `options.env` ont été raccordées.

Deux preuves GF1 étaient fausses : le cas demi-duplex n'avait aucun tour `inFlight`, et le cas
50 ms ne traversait pas le `||` de production. Les harnais ont été corrigés avant le code.

```text
ROUGE — test GF1 SENSE1 corrigé : 3 failed | 5 skipped (8)
- demi-duplex : reçu [ 'Bruit de retour haut-parleur' ] au lieu de []
- AEC non approuvée : true au lieu de false
- transitoire 50 ms : onBargeInStart appelé 1 fois

VERT — GF1 SENSE1 corrigé : 3/3 ; voisins CONV2/speech-reaction/TV/GT2 :
6 fichiers, 67/67 ; gardes SENSE6 + engagement + Maison : 10 fichiers, 18/18.
```

## Régression 3 — GK17 × PolicyEngine, approbation flotte ignorée

GK17 doit garder les trois outils de lecture utilisables sans TTY après allowlist, métadonnée
`fleetSafe`, scope JWT et workspace explicite. La lane sécurité exige que `PolicyEngine` reste
l'autorité et qu'une décision `needs_approval` ne soit jamais transformée en autorisation.

Le profil borné est maintenant présenté à `PolicyEngine` comme faible risque et autorisé par lui ;
toute autre décision `needs_approval` repasse par `ConfirmationService` et échoue fermée en
headless. Aucun nouveau drapeau : `CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT` reste l'unique activation.

```text
ROUGE — test flotte « honors needs_approval » : 1 failed | 15 skipped ; reçu ok=true.
VERT — bridge flotte + PolicyEngine : 2 fichiers, 28/28 ; bridge serveur : 26/26.
```

Le voisin `tests/server/peer-tool-bridge.test.ts` utilisait `hello.txt`. Sous le confinement GF2,
`TMPDIR` vit dans le clone et le `*.txt` du `.gitignore` est honoré par ripgrep : le test attendait
donc à tort un fichier volontairement ignoré. La fixture est devenue `hello.md`, avec les mêmes
octets et les mêmes assertions de lecture/recherche.

## Régression 4 — GK28 × cœur Agent, sauvegarde de session

GK28 doit persister le modèle, le fournisseur, les totaux et chaque tour de coût. Le cœur Agent
doit rester tolérant aux anciens modèles absents et aux doubles de test partiels. Les données
réelles sont conservées ; seuls les champs absents replient vers `unknown` ou une liste vide.

```text
ROUGE — baseline GF1 :
- inferCostProvider(undefined) → TypeError sur trim ;
- costTracker sans getSessionUsage → TypeError ;
- getCurrentModel() undefined → TypeError.
Suites officielles : codebuddy-agent et grok-agent rouges sur saveCurrentSession.

Premier vert GF1 : 3/3. Le voisin `codebuddy-agent` a ensuite révélé un quatrième champ absent
dans son double historique (`report.sessionTokens`) ; le même repli zéro borné lui est appliqué.
Au rejeu suivant, le test passait mais Vitest signalait un rejet non géré : son ancien
`SessionStore` factice ne possède pas `attachUsageToCurrentSession`. `SessionFacade` centralise
désormais l'attachement optionnel dans une seule garde, sans omettre les stores modernes.

VERT — GF1 GK28 : 3/3 ; `codebuddy-agent`, `grok-agent`, `cost-report`, commande cost et
`session-store` : 5 fichiers, 170/170, aucun rejet non géré.
```

## Régression 5 — GK1 × tests Docs, casse du README Cowork

GK1 a rendu le README Cowork portable sur Linux par le renommage `readme.md` → `README.md`. Le
contrôle des captures et ancres publiques doit continuer à parcourir ce document et à vérifier ses
six ancres. Les deux références internes du test pointent maintenant vers le nom canonique ; aucune
assertion de contenu ou de cardinalité n'est changée.

```text
ROUGE — baseline GF1 : ancien chemin détecté ; public-screenshots : ENOENT cowork/readme.md.
VERT — GF1 complet + docs publiques : 3 fichiers, 26/26.
```

## Régression 6 — GK5/DARK3 × dépôt public, infrastructure privée publiée

GK5 et DARK3 doivent conserver la topologie fonctionnelle Kyutai → replis, le choix `n_q` et un
exemple de configuration utilisable. Le garde public interdit les noms et adresses de
l'infrastructure réelle. Les textes et aides utilisent donc « serveur GPU privé/local » et
`gpu-voice.example`, sans changer aucune clé de configuration ni le comportement TTS.

```text
ROUGE — donnees-personnelles : 1/1 échec, cinq fichiers suivis signalés.
VERT — donnees-personnelles : 1/1 ; assistant-config : 12/12.
```

## Vérifications finales

À compléter.

## Grille régression → correctif → commit

À compléter.
