# RAPPORT-GK26 — La porte de revue des diffs (`CODEBUDDY_DIFF_REVIEW`) en vrai

Mission : exercer **pour de vrai** la porte de revue des diffs (`CODEBUDDY_DIFF_REVIEW=static|full`, boucle de révision) dans un dépôt jouet, via l'agent headless (Ollama) et les cinq surfaces d'écriture.

- Clone autorisé : `~/DEV/cb-repar-jumeaux-5-2026-09-02` uniquement
- Branche : `fix/gk26-diff-review-reel-2026-09-03`
- HEAD au départ : `5e7639b42` (`Merge GK22 …`)
- Date : 2026-09-03 (Europe/Paris)
- Agent : Grok 4.6
- Rapport créé **avant** toute inspection de `src/review/` (réservation `cd460b3cd`)
- Buddy invoqué depuis le clone : `node node_modules/tsx/dist/cli.mjs src/index.ts` (le lanceur `~/.local/bin/buddy` pointe vers `~/code-buddy`, interdit)
- HOME temporaire : `_qa/gk26/home`. Aucune écriture dans le vrai `~/.codebuddy` (pas de `diff-reviews.jsonl` réel)
- Relecteur `full` : Ollama local `qwen3.8:27b` (aucune API payante). Agent headless : `qwen3.8-ctx32k` (même famille, `num_ctx` 32k)

## Garde-fous (rappel)

- Aucun push, aucun `git prune` / `git reset --hard` / `rm -rf` / `git add -A` / `git commit -a`.
- Aucune API payante. Ollama local uniquement.
- Aucun service systemd. ComfyUI 8188 laissé intact (`ss -ltn`).
- Original `~/code-buddy` interdit. HOME temporaire dans le clone seulement.
- `package-lock.json` touché par `npm install` (clone sans `node_modules`) — **non commité**.

## Journal

### 2026-09-03 — création du rapport (avant inspection)

HEAD `5e7639b42`. Arbre propre. Réservation `cd460b3cd`.

### 2026-09-03 — inspection (après réservation)

Surface réelle :

- Porte : `reviewGatedWrite` (`src/review/write-gate.ts`) → `reviewAndApply` (`review-engine.ts`) → `applyReviewedDiff` + journal `.codebuddy/diff-reviews.jsonl`.
- Helper : `maybeReviewGatedWrite` (`src/tools/review-gate-helper.ts`) — hors-base fail-closed **avant** la porte.
- Cinq surfaces : `str_replace` / `insert` / `replace_lines` (`text-editor.ts`), `create_file` + alias `write_file`, `multi_edit`, `apply_patch` (`computePatchedFiles` strict).
- `full` : `resolveDefaultReviewClient` + deux lentilles (correctness, security). `CODEBUDDY_DIFF_REVIEW_REVISE=true` → `reviewApplyWithRevisions`, lignée dans `intent`.
- Tests existants : 75 verts (`tests/review/` + `tests/tools/text-editor-review-gate.test.ts`) avant correctif.

Jouet : `_qa/gk26/toy/` (`src/add.ts`, `src/greet.ts`, `tests/add.test.ts`).

### 2026-09-03 — parcours réel

**Static (outils réels, 11/11)** — `_qa/gk26/live-static.mjs` : str_replace, multi_edit, apply_patch sain, apply_patch hunk raté (rien d'écrit), create_file, alias `write_file`, hors-base helper, hors-base apply_patch, TOCTOU (mutation pendant le chat → `stale-base`, apply aborté), `rollbackAppliedDiff` restaure.

**Full avant correctif** : `resolveDefaultReviewClient()` → `CLIENT NULL` alors que `qwen3.8:27b` est dans le pool Ollama (heuristique gpt-5/opus/gemini/grok seulement).

**Full après D1–D3** :

- S10 relecteur mort (`gk26-model-does-not-exist`) : 2,1 s, `review UNAVAILABLE`, 404, fichier intact.
- S7b diff sain : 25,7 s, `review accepted (full: static-gate, correctness, security) — applied: src/add.ts`.
- S7 suppression de test : 101,6 s, `REJECTED` (mérite, **sans timeout**), `tests/add.test.ts` intact.
- S8 revise : journal `revision 1 of diff-b76686aab31d1733` (lignée). La révision re-passe la porte ; le 2e tour reste `reject` (le réviseur a trop changé le fichier) — contrat lignée tenu.

**Agent headless** (`qwen3.8-ctx32k`, `CODEBUDDY_DIFF_REVIEW=static`, `--permission-mode dontAsk`, `--directory _qa/gk26/toy`) : 5/5 outils, journal `applied: true` :

| Outil | Fichier | Preuve |
|---|---|---|
| `str_replace_editor` | `src/add.ts` | `// gk26-agent-str` puis patch |
| `create_file` | `src/mul.ts` | `export function mul…` |
| `write_file` (alias) | `src/agent-write.ts` | `export const agentWrite = true;` (ledger `origin.label=create_file`) |
| `multi_edit` | `src/greet.ts` | `hi` + `name: string /* gk26 */` |
| `apply_patch` | `src/add.ts` | `// gk26-agent-str patched-by-agent` |

Logs : `_qa/gk26/logs/agent-*.log`. Coût agent `$0.0000`.

## Scénarios (contrat mission)

| # | Mode | Scénario | Attendu | Obtenu | Correctif | Commit |
|---|---|---|---|---|---|---|
| S1 | static | `str_replace` sain | appliqué transactionnellement | OK outils + agent, journal `applied:true` | — | — |
| S2 | static | `multi_edit` sain | appliqué | OK outils + agent | — | — |
| S3 | static | `apply_patch` sain / hunk raté | appliqué ; pas partiel | sain OK ; hunk raté `does not resolve`, fichier intact | — | — |
| S4 | static | `create_file` / `write_file` | appliqué | OK outils + agent (alias → `create_file`) | — | — |
| S5 | static | chemin hors base | rejeté fail-closed | helper + apply_patch isolation, rien d'écrit | — | — |
| S6 | static/full | TOCTOU | rejeté | `stale-base`, `applied:false`, rien d'écrit sur le fichier d'origine | — | — |
| S7 | full | suppression d'un test | non appliqué, annotations | 1er essai : timeout 180 s (fail-closed). Après D2+D3 : **mérite REJECT**, test intact, 101 s | D2 + D3 | `95317aa71` `7f9836982` |
| S7b | full | diff sain | appliqué | 25,7 s, `accepted (full: static-gate, correctness, security)` | D2 + D3 | idem |
| S8 | full+revise | révision re-passe la porte | JSONL avec lignée | `intent` contient `revision 1 of diff-b76686aab31d1733` | — (après D2) | — |
| S9 | — | `rollbackAppliedDiff()` | état restauré | OK (même processus) | — | — |
| S10 | full | relecteur mort | fail-closed, pas « accepté » | 404 en 2 s, `UNAVAILABLE`, fichier intact | — | — |

## Défauts (rouge → vert)

**D1 — `full` ignore Ollama `qwen3.8:27b`.** `STRONG_REVIEWER_PATTERN` ne matchait que gpt-5/opus/sonnet/fable/gemini/grok. Pool live : 28 modèles, `qwen3.8:27b` présent, `CLIENT NULL` → fail-closed « no LLM » au lieu de relire. Tests rouges : `pickReviewerPoolEntry` absent / ne choisit pas qwen. Correctif : pin `CODEBUDDY_DIFF_REVIEW_MODEL`, puis `GROK_MODEL`, puis premier local fort (`qwen3.[5-9]`, …) ; omniroute cloud n'est pas choisi tant qu'un local fort existe. Live : `PICK qwen3.8:27b`, `CLIENT RESOLVED`. Commit `1fc5f3ce7`.

**D2 — relecteur 27b timeout 180 s (thinking / 16k max tokens).** Un `curl` Ollama borné (`max_tokens=256`, `reasoning_effort=none`) répond **en 8,2 s** et refuse déjà la suppression de test. Le client défaut héritait `maxOutputTokens: 16384`. Test rouge : `chat()` appelé sans options. Correctif : `temperature: 0`, `maxTokens: 1024`, `disableProviderFallback: true`. Commit `95317aa71`.

**D3 — lentilles `Promise.all` : le 2e timeout s'empile sur un Ollama sériel.** Même après D2, correctness timeout 90 s pendant que security jugeait (S7 « merit=false » à cause du mot `unavailable` dans l'annotation). Un diff **sain** avec une lentille morte serait fail-closed (AND). Test rouge : client mutex 80 ms × 2, timeout 120 ms → `reject` au lieu d'`accept`. Correctif : `for await` sériel. Live : sain 25,7 s accept ; suppression de test 101 s reject mérite, 0 timeout. Commit `7f9836982`.

Prettier : `d7b30a78e` (NUL de dédoublonnage conservés, 2 octets).

## Preuves

```
npx vitest run tests/review/ tests/tools/text-editor-review-gate.test.ts
  Test Files  9 passed (9)
  Tests       83 passed (83)

npx tsc --noEmit -p tsconfig.json                 # TSC_EXIT=0
npx tsc --noEmit -p tsconfig.gpuNode-identity.json # TSC_GPU_EXIT=0
npx eslint src/review/llm-client.ts src/review/review-engine.ts \
          src/review/llm-reviewer.ts tests/review/llm-client.test.ts \
          tests/review/review-engine.test.ts --quiet   # ESLINT=0
```

Agent (extraits) :

```
INFO  [notification] str_replace_editor completed in 2381ms
INFO  [notification] create_file completed in 70ms
INFO  [notification] write_file completed in 42ms
INFO  [notification] multi_edit completed in 48ms
INFO  [notification] apply_patch completed in 50ms
```

Ledger agent apply_patch :

```
{"origin":{"kind":"agent","label":"apply_patch"},"mode":"static","decision":"accept","applied":true,"appliedFiles":["src/add.ts"]}
```

## Reste ouvert

- Les checkpoints de `rollbackAppliedDiff()` sont **en mémoire de processus** : après sortie de l'agent, l'`checkpointId` du JSONL ne permet plus de rewind. Hors mission (architecture existante).
- `write_file` journalise `origin.label=create_file` (alias). Comportement, pas un trou de porte.
- `package-lock.json` dirty (`npm install` sur clone vide) — non commité.
- GUI Electron / Cowork non cliquée.

## Commits

| SHA | Sujet |
|---|---|
| `cd460b3cd` | docs(gk26): réserver le chantier |
| `1fc5f3ce7` | fix(review): pick local qwen3.8 (D1) |
| `95317aa71` | fix(review): cap maxTokens 1024 (D2) |
| `7f9836982` | fix(review): lentilles sérielles (D3) |
| `d7b30a78e` | style(review): prettier |
| `27764ba83` | docs(gk26): consigner le parcours réel |
