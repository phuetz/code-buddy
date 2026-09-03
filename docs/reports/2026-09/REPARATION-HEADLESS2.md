# Réparation HEADLESS2 — `dontAsk` et outil `bash`

Date : 2026-09-03  
Dépôt : `~/DEV/cb-headless2-2026-09-03`  
Branche : `fix/headless2-dontask-bash-2026-09-03`

## Journal de travail

Rapport créé avant toute inspection, conformément à la mission. Les journaux
bruts sont conservés sous `_qa/headless2/` (non suivis) ; les chemins de home
y sont redacted dans ce rapport pour respecter le garde-fou de données
personnelles.

### Hypothèses à vérifier

- expansion de `~` dans la politique de chemins ;
- demande d'escalade hors bac à sable pour une commande anodine ;
- traduction de `dontAsk` en headless.

## Reproduction rouge (avant correctif)

Commande utilisée avec Ollama local et HOME temporaire dans le clone :

```text
CODEBUDDY_PROVIDER=ollama HOME=~/DEV/cb-headless2-2026-09-03/_qa/headless2/home \
  npx tsx src/index.ts -m qwen3:4b-instruct --permission-mode dontAsk -p \
  "Exécute exactement : pwd && git -C ~/DEV/cb-headless2-2026-09-03 status -sb | head -3, puis colle la sortie"
```

Les trois variantes réellement testées ciblaient le clone avec `~`, avec son
chemin absolu (conservé seulement dans le journal brut), puis avec `.`. Avant
correction, chacune produisait :

```text
WARN Tool error {"tool":"bash","error":"Approval requires an interactive terminal or configured remote approval channel"}
je m'abstiens / I cannot comply
```

Journaux : `_qa/headless2/repro-tilde-red.log`,
`_qa/headless2/repro-absolute-red.log`, `_qa/headless2/repro-dot-red.log`.

## Cause établie

- `src/sandbox/execpolicy.ts:197-213` autorisait les lectures Git, mais
  `src/sandbox/execpolicy.ts:221-239` classait `-C` en frontière `ask`.
- `src/sandbox/execpolicy.ts:714-736` retient la décision la plus stricte de
  chaque segment de la chaîne ; la commande anodine devenait donc `ask`.
- `src/tools/bash/bash-tool.ts:443-505` transformait cette décision en
  demande d'exécution hors sandbox ; `src/utils/confirmation-service.ts:519-523`
  la refusait correctement sans TTY.
- `src/security/permission-modes.ts:234-242` montre que `dontAsk` n'était pas
  ignoré : `bash` est catalogué comme outil destructeur et le mode renvoyait
  `allowed: true`, mais `prompted: true`. Le défaut déclencheur était la
  classification de politique, pas la syntaxe CLI.
- `src/tools/bash/command-validator.ts:212-228` ne testait initialement que la
  chaîne littérale ; `cat ~/.ssh/id_ed25519` pouvait donc contourner le test
  de chemin protégé.

## Correctifs et tests régressifs

1. `builtin-git-safe` accepte désormais `-C <chemin>` devant les sous-commandes
   de lecture ; la règle de frontière exclut explicitement ces lectures. Le
   test `tests/tools/bash-execution-policy.test.ts:51-63` couvre `.`, le cwd et
   `~/DEV/cb-headless2-2026-09-03` en `dontAsk`. Le test était rouge avant le
   correctif ; il est vert avec 13 tests.
2. Le validateur étend `~` avec `os.homedir()` avant de comparer les chemins
   protégés (`src/tools/bash/command-validator.ts:212-228`). Le cas
   `cat ~/.ssh/id_ed25519` a d'abord rougi, puis
   `tests/bash/command-validator-security-regression.test.ts` est vert : 40/40.
3. Le sandbox Docker conserve le HOME de l'appelant
   (`src/tools/bash/execution-policy.ts:282-305`), expose l'éventuel
   `node_modules` symlinké en bind mount strictement read-only, et donne à
   `.vite-temp` un tmpfs éphémère. Les montages sont validés dans
   `src/sandbox/docker-sandbox.ts:696-730` et couverts par
   `tests/sandbox/docker-sandbox.test.ts` : 27/27.

Les refus de sécurité sont inchangés et testés : `rm -rf /`, `curl ... | sh`
et `cat ~/.ssh/id_ed25519` restent bloqués par le validateur statique.

## Reproduction verte et preuve live

Avant les essais live finaux, `ollama ps` confirmait le modèle local
`qwen3:4b-instruct` chargé ; aucun fournisseur payant n'a été utilisé. Les
trois variantes tilde, chemin absolu et `.` ont ensuite exécuté `bash` avec
code de sortie 0, sans le message d'approbation. La sortie redacted commune
est :

```text
~/DEV/cb-headless2-2026-09-03
## fix/headless2-dontask-bash-2026-09-03
?? _qa/headless2/
?? node_modules
```

Journaux verts : `_qa/headless2/final-tilde.log`,
`_qa/headless2/final-absolute.log`, `_qa/headless2/final-dot.log`.

La mission jouet réelle Ollama a exécuté une chaîne unique `ls | grep | npx
vitest` en headless `dontAsk`. Résultat : `bash completed`, modèle
`qwen3:4b-instruct`, coût `$0.0000`, fichier de sécurité Vitest `1/1`,
`40/40` tests passés en 235 ms. Journal :
`_qa/headless2/final-toy-mission.log`.

## Vérifications finales

```text
npx vitest run tests/tools/bash tests/security tests/cli
Test Files 66 passed (66)
Tests      1131 passed (1131)

npx tsc --noEmit -p .                         exit 0
npx eslint src/sandbox/execpolicy.ts src/sandbox/docker-sandbox.ts \
  src/tools/bash/command-validator.ts src/tools/bash/execution-policy.ts \
  tests/tools/bash-execution-policy.test.ts \
  tests/bash/command-validator-security-regression.test.ts \
  tests/sandbox/docker-sandbox.test.ts        exit 0
git diff --check                              exit 0
```

Commits thématiques : `6d622a439` (Git `-C`), `6ffb5da15` (chemins `~`),
`7227eb96c` (HOME sandbox), `1dcb2c10d` (dépendances read-only/cache),
`9fb115ed6` (QA ignorée), avec
les réservations documentaires précédentes `8ea7a4c38`, `8dce39a48`,
`a90cbfa70` et `9e1e9ac5f`.

## Bilan (dix lignes maximum)

1. Cause : la règle `builtin-git-boundary` classait `git -C` en `ask`.
2. En headless, `ConfirmationService` refusait cette demande sans TTY.
3. `dontAsk` était bien transmis ; la politique d'exécution était trop stricte.
4. Les lectures Git `-C` sont maintenant confinées en sandbox, sans escalade.
5. Le validateur étend désormais `~` pour protéger aussi `~/.ssh`.
6. Le Docker sandbox conserve HOME et les dépendances read-only nécessaires aux tests.
7. Tilde, absolu et `.` réussissent en vrai avec Ollama `qwen3:4b-instruct`.
8. La mission jouet `ls | grep | vitest` réussit en headless `dontAsk`.
9. Preuves : 66 fichiers / 1131 tests, tsc 0, ESLint ciblé 0, diff-check 0.
10. Restent refusés : suppression racine, pipe réseau vers shell et secrets SSH.
