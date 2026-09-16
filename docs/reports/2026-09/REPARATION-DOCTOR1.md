# Réparation DOCTOR1 — reliquats d’INCONNU1

Rapport initialisé avant toute inspection du dépôt, conformément à la mission du
2026-09-04. Travail effectué dans `~/DEV/cb-doctor1-2026-09-04`, branche
`fix/doctor1-reliquats-2026-09-04`. `~/code-buddy` n’a pas été écrit.

## Périmètre

- R1 : sélection justifiée d’un modèle Ollama pour `buddy doctor --fix`.
- R2 : documentation et tests de `/batch` et `buddy improve`.

## R1 — sélection Ollama

Le défaut a d’abord été reproduit par le test demandé, avant le changement de
production.

Rouge :

```text
$ npx vitest run tests/doctor/ollama-selection.test.ts
❯ tests/doctor/ollama-selection.test.ts (3 tests | 1 failed)
× chooses a small tool-calling instruct model instead of a larger rag model
TypeError: selectOllamaModel is not a function
```

Correctif : `detectOllama()` conserve maintenant les tailles et métadonnées de
`/api/tags`. `selectOllamaModel()` applique, dans cet ordre :

1. `supportsToolCalls === true` dans `src/config/model-tools.ts` ;
2. taille connue strictement inférieure à la RAM libre du système ;
3. préférence `instruct`/`coder`, puis taille croissante ;
4. exclusion systématique des noms `embed`, `rag` et `vision-only`.

Une absence de candidat renvoie `model: null` et `doctor` n’expose alors pas de
fix écrivant `user-settings.json`. Une sélection affiche une seule justification
du type `tool-calling, 2.3 GiB < 37.3 GiB free RAM, instruct/coder family`.

Vert :

```text
$ npx vitest run tests/doctor/ollama-selection.test.ts
Test Files  1 passed (1)
Tests  4 passed (4)
```

La sonde réelle est restée en lecture seule :

```text
$ curl -fsS --max-time 3 http://127.0.0.1:11434/api/tags
22 modèles installés ; gemma4-moe-rag:latest = 14.6 GiB ; qwen3:4b-instruct = 2.3 GiB

$ npx tsx --eval '(détection + sélection, sans --fix)'
detectedModels: 22
freeRamGiB: 37.3
selection: qwen3:4b-instruct
reason: tool-calling, 2.3 GiB < 37.3 GiB free RAM, instruct/coder family
```

Aucun modèle n’a été téléchargé et aucun service n’a été démarré, arrêté ou
reconfiguré.

## R2 — pages d’entrée

Le test documentaire a d’abord rougi sur la première page :

```text
$ npx vitest run tests/docs/doctor1-entrypoints.test.ts
❯ tests/docs/doctor1-entrypoints.test.ts (1 test | 1 failed)
× keeps /batch and buddy improve discoverable on both entry pages
AssertionError: README.md: expected ... to contain '/batch'
```

Les deux pages mentionnent maintenant `/batch`, les sous-agents multiplexés
`ThreadDelegate`, `CODEBUDDY_BATCH_CONCURRENCY` (défaut `1`), `buddy improve`,
`CODEBUDDY_SELF_IMPROVE` et le mode `propose-only`. Les commandes
`cycle|tools|skills|loop` ne gardent un résultat validé qu’avec `--apply` et
l’opt-in explicite.

Vert :

```text
$ npx vitest run tests/docs/doctor1-entrypoints.test.ts
Test Files  1 passed (1)
Tests  1 passed (1)
```

## Commits thématiques

- `6434dbcec` — `fix(doctor): choose a justified Ollama model` (R1).
- `6f0c1449b` — `docs: expose batch and self-improvement entry points` (R2).
- Le présent rapport et la ligne de coordination seront le commit documentaire
  séparé après les vérifications finales.

## Vérifications finales

Commande exigée, exécutée exactement :

```text
$ npx vitest run tests/commands tests/docs tests/cli
Test Files  1 failed | 157 passed (158)
Tests  16 failed | 1482 passed (1498)
Exit code: 1
```

Les 16 échecs sont tous dans `tests/docs/revue-gemini-docs.test.ts` et
préexistants (le même lot est signalé dans la coordination et les rapports
antérieurs) ; aucun test R1/R2 n’échoue.

```text
$ npx tsc --noEmit -p .
Exit code: 0

$ npx eslint src/doctor/index.ts src/doctor/ollama-model-selection.ts \
    src/wizard/environment-detection.ts tests/doctor/ollama-selection.test.ts \
    tests/docs/doctor1-entrypoints.test.ts
Exit code: 0

$ git diff --check
Exit code: 0
```

## Bilan (10 lignes max)

R1 ne choisit plus le premier modèle Ollama.
Le choix exige tool-calling déclaré, taille connue sous la RAM libre et préférence instruct/coder.
Les modèles embed, rag et vision-only sont exclus.
La preuve locale GET a vu 22 modèles et choisi qwen3:4b-instruct à 2.3 GiB pour 37.3 GiB libres.
Un inventaire sans candidat ne déclenche aucune écriture.
R2 documente `/batch` et `buddy improve` dans README et getting-started.
Les drapeaux vérifiés sont CODEBUDDY_BATCH_CONCURRENCY et CODEBUDDY_SELF_IMPROVE.
Les tests dédiés rouge puis vert sont collés ci-dessus.
Les commits fonctionnels sont 6434dbcec et 6f0c1449b.
La suite exigée reste partiellement rouge : 16 tests docs préexistants ; tsc, ESLint ciblé et diff-check sont verts.
