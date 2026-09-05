# RAPPORT GK18 — `buddy dev plan|run|pr|fix-ci` (golden paths) en vrai

Date : 2026-09-03  
Agent : Grok 4.6  
Clone : `~/DEV/cb-repar-context-2026-09-02`
Branche : `fix/gk18-dev-golden-path-2026-09-03`  
Base : `587bbc3ae` (`Merge GK4/GK4b`)  
Réservation : `64cf5611d`

Ce rapport a été créé **avant** toute inspection des sources `src/commands/dev*.ts`, `src/security/write-policy.ts` et `tests/commands/dev/`, puis complété au fil de l'eau.

## Contraintes

- Clone uniquement. Original `~/code-buddy` non touché.
- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a` sur le clone.
- Aucune API payante. Ollama local (`qwen3:4b-instruct`, `qwen3.8-ctx32k`).
- Aucun service (ComfyUI 8188/8189, buddy 3000/3001) touché.
- HOME isolé `_gk18/home` (gitignoré). `gh` remplacé par un stub dans `_gk18/bin`.
- Dépôt jouet `_qa/gk18-jouet/` + remote factice `_gk18/remote.git` (`git init --bare`).

## Parcours réel (jouet)

Jouet Node : `add(2,3)` renvoyait `-1` ; `npm test` rouge ; `npm run ci` rouge (`ciGate: "red"`).

| Commande | Attendu | Obtenu (avant) | Correctif | Commit |
|---|---|---|---|---|
| `buddy dev plan "corrige le bug"` | PLAN.md écrit, exit 1 si vide | Stream stdout, exit 0 même vide/stall ; pas de PLAN.md. Live 1 : stall 654 s, exit 0, message d'erreur annoncé comme plan. | `isMeaningfulPlan` + `writeDevPlan` ; skip workflow-guard sur « Plan only » | `d1e6f84f2` |
| `buddy dev run` (sans objectif) | Reprend PLAN.md ; WritePolicy.strict ; exit 1 si échec | `error: missing required argument 'objective'` ; workflow failed → exit 0 | Objectif optionnel, `resolveRunObjective`, `workflowExitCode` | `acdaedb9d` |
| `buddy dev run` commit | Message conventionnel, fichiers nommés | Aucun commit (doc « auto-commits » fausse) | `conventionalCommitNamedFiles` (jamais `git add -A`) | `1a0da83e4` |
| WritePolicy.strict | Aucune écriture directe | `str_replace` bloqué, mais `echo > file` passait ; Auto-Repair relançait le bash bloqué (live 16 min, `[Auto-Repair 1/3]`) | `gateShell` + skip auto-repair si `WritePolicy` | `58dd74983`, `8486ba495` |
| `buddy dev pr` | Titre/corps ; fail-closed sans gh ; ou push local | Relançait tout le workflow, résumé LLM, exit 0 sans PR | Titre/corps git ; `gh pr create` ; push origin local seulement | `6dc802049` |
| `buddy dev fix-ci` | Log obligatoire ; pas de hang ; pas de `git add -A` | Hang sur pipe stdin ouvert ; `--auto` faisait `git add -A` + `git push` | `readStdinIfPiped` 400 ms ; commit nommé ; push local only | `c2378523b`, `1e5c99012` |
| Doc | Recette `plan ; run ; pr ; fix-ci` vraie | `pr` « generate PR summary » ; `run` exigeait l'objectif | `docs/commands.md`, `docs/features.md`, skill | `d9021ae89` |

### Rejeu après correctifs

- **plan** (Ollama `qwen3:4b-instruct`, 19 s, $0) : PLAN.md écrit, objective `corrige le bug`, exit 0. Plus de `[workflow-guard]`.
- **run** (Ollama `qwen3.8-ctx32k`) : 16 min, coincé sur Auto-Repair après un bash (avant `8486ba495`) ; `qwen3:4b-instruct` 180 s sans outil. **Non abouti en agentique locale.** Le bug `add()` a été corrigé avec l'outil produit `ApplyPatchExecuteTool` (`Updated: src/add.js`) ; `npm test` 1/1 vert.
- **pr** (1 s, stub `gh`) : titre `fix: corrige le bug`, corps imprimé, `Pushed to local origin`, exit 0. Remote factice `refs/heads/main` = `b214755`.
- **fix-ci --log** : n'hang plus ; 4b n'a pas fini en 90 s. `ciGate` passé à `green` via `apply_patch` ; `npm run ci` → `CI passed`.

## Preuves tests

`npx vitest run tests/commands/dev tests/security/write-policy.test.ts tests/agent/middleware/auto-repair-middleware.test.ts tests/agent/middleware/workflow-guard.test.ts` → **11 fichiers / 95 verts**.

ESLint ciblé (fichiers GK18 hors unused `RepairEngine` préexistant) : 0 erreur.

## Ouvert

- `buddy dev run` agentique sur qwen3.8-ctx32k trop lent / stall (prefill 32k + outils) pour le jouet dans un délai raisonnable. Le contrat CLI + `apply_patch` est prouvé ; la boucle LLM locale n'a pas livré le patch toute seule.
- `buddy dev issue` commite encore via `git add -A` (hors périmètre `plan|run|pr|fix-ci`).
- Compteur `[tokens: …]` et bannière `[shutdown]` restent dans stdout.

## Garde-fous tenus

Aucun push du clone, aucun service touché, HOME `_gk18/home` seulement, `gh` réel jamais appelé (stub). Jouet et HOME gitignorés / non suivis.
