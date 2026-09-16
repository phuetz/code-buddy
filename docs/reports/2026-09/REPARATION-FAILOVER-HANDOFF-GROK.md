# REPARATION-FAILOVER-HANDOFF-GROK — repli utilisable vers un modèle local

Date : 2026-09-06 (Europe/Paris)
Agent : Grok 4.6
Worktree : `~/DEV/cb-failover-2026-09-06`
Branche : `fix/failover-handoff-2026-09-06`
HEAD au départ : `88a27ddc0` (`docs(audit): etude source omniroute 3.8.49 vs code buddy failover et handoff`)
Original `~/code-buddy` : interdit (jamais ouvert, jamais écrit)
Rapport créé **avant toute inspection**.
HOME temporaire : `_qa/fo/home`. Aucune écriture dans le vrai `~/.codebuddy`.
Copie lecture seule de `~/.codebuddy/codex-auth.json` vers le HOME isolé autorisée pour l'essai réel, jamais affichée.
Ollama : `http://127.0.0.1:11435`. Modèles autorisés : `qwen3:4b-instruct` et `qwen3.8-ctx32k:latest` uniquement.

Étude source : `docs/audits/2026-09-06-etude-omniroute-failover-agy.md`.
Constat de l'étude : repli ChatGPT 429 → Ollama réussit SANS outils en 1,2 s ; AVEC les outils de l'agent il échoue en 400 (~60 k tokens de définitions d'outils pour une fenêtre de 32 k) et l'erreur 400 est masquée par le 429 initial.

## Mission

Rendre le repli de fournisseur réellement utilisable vers un modèle local (5 améliorations de l'étude OmniRoute) :

1. Élagage des outils au handoff (RAG ≤ N + outils déjà appelés + `tool_search`, puis compactage, budget `contextWindow(cible) − maxOutputTokens − marge 10 %`).
2. Pré-filtrage par capacité (sauter une cible trop petite avec journal `[fallback] <cible> ignorée (contexte 32 k < 41 k)`).
3. Diagnostic honnête (429 initial + chaque échec de cible ; parole Lisa « cerveau de secours n'a pas suffi »).
4. Événement vers l'utilisateur (ligne discrète une fois par bascule + une fois au retour, compagnon/Telegram/PWA ; rien si flag off).
5. Unification `CODEBUDDY_LLM_FAILOVER` → alias documenté de `CODEBUDDY_PROVIDER_FALLBACK`.
6. Preuves Vitest + tsc + lint + essai réel avec outils.

## Garde-fous

- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Vitest : `HOME=~/DEV/cb-failover-2026-09-06/_qa/fo/home` et `env -u FORCE_COLOR`.
- Ports ≥ 5000. ComfyUI 8188/8189 non touché.
- Jamais `/home/<user>` ni prénom dans les fichiers suivis (écrire `~`).
- Un commit par point. `git add` fichier par fichier.
- Pas de verdict dans ce rapport (le pilote le fera).

## Journal

### 2026-09-06 — création du rapport (avant inspection)

HEAD `88a27ddc0`. Branche déjà extraite. Réservation à commiter.

### Inspection

- Handoff (`provider-handoff.ts`) compacte les messages et répare les paires d'outils, mais transmet le tableau `tools` intact.
- `chat` / `chatStream` déclarés appellent `prepareFailoverMessages` puis renvoient `tools` d'origine au client de secours.
- `CODEBUDDY_LLM_FAILOVER` injecte le registre via `applyActiveLlmFailover` (chemin Hermes), distinct de `CODEBUDDY_PROVIDER_FALLBACK`.
- `provider:fallback` est déjà émis ; le canal compagnon et la PWA `status` ne montrent pas de ligne utilisateur.
- Un 400 de cible est avalé : `throw primaryError` masque l'échec Ollama.

### Implémentation (un commit par point)

| Point | Commit | Contenu |
|---|---|---|
| Réservation | `24c18f058` | Rapport + ligne Fable 5 |
| 1. Élagage | `9fe7669d5` | RAG + `tool_search` + outils déjà appelés, cap 12, budget 90 % du leftover, `qwen3.8-ctx32k` plafonné à 32 k |
| 2. Pré-filtre | `9b28e4ef7` | `[fallback] <cible> ignorée (contexte 32 k < 41 k)` |
| 3. Diagnostic | `a9d7eeabc` | `ProviderFailoverExhaustedError` (message + `cause` + `details`) ; Lisa « cerveau de secours n'a pas suffi » |
| 4. Annonce | `5b46f3772` | Une ligne compagnon/Telegram/PWA `status` par bascule et au retour ; silence si flag off |
| 5. Alias | `3ae522b9c` | `CODEBUDDY_LLM_FAILOVER` = alias déprécié du même chemin |
| Cap 32 k | `68e40ced9` | chars/3, plafond 6 outils et système 25 % — le 400 réel 4b passait encore à 10 outils |

### Preuves

```text
HOME=~/DEV/cb-failover-2026-09-06/_qa/fo/home env -u FORCE_COLOR \
  npx vitest run tests/codebuddy tests/providers tests/channels tests/server \
  tests/security/donnees-personnelles.test.ts
# 183 fichiers : 179 passed / 3 skipped / 1 failed
# 2789 passed / 9 skipped / 1 failed
# Rouge : tests/security/donnees-personnelles.test.ts
#   docs/audits/2026-09-06-etude-omniroute-failover-agy.md (liens file:// nvm, étude déjà sur HEAD, hors lane)

npx tsc --noEmit -p tsconfig.json    # exit 0
npx eslint . --ext .js,.jsx,.ts,.tsx --quiet    # exit 0
git diff --check    # exit 0
```

### Essai réel (HOME `_qa/fo/home`, `codex-auth.json` recopié en 0400, jamais affiché)

Cwd `_qa/fo/trial` (3 fichiers). `CODEBUDDY_DISABLE_MCP=true`. Ollama `http://127.0.0.1:11435`.

**qwen3.8-ctx32k:latest** — 664 s, EXIT 1 (stall 120 s après des tours qui ont bien basculé, pas un 400) :

```text
[fallback] chatgpt → ollama:qwen3.8-ctx32k:latest (quota_exhausted, reset dans 8 h)
```

Aucun `400 context length`. Le 27B local a accepté le prompt élagué puis a cessé de répondre (`LlmStallError` 120 s).

**qwen3:4b-instruct** — 96 s, EXIT 0 :

```text
[fallback] handoff ollama:qwen3:4b-instruct tools 20→6 (~7317 tok, fenêtre 32768)
[fallback] chatgpt → ollama:qwen3:4b-instruct (quota_exhausted, reset dans 7 h)
```

Avant le cap 6, la même commande échouait en 3–5 s avec le diagnostic honnête :

```text
…usage_limit_reached…; ollama:qwen3:4b-instruct → 400 context length
```

Après : EXIT 0, l'agent a appelé `file_search` (le workspace du dépôt, pas seulement les 3 fichiers du cwd).

### Bilan

1. Élagage outils au handoff (RAG, déjà appelés, `tool_search`) puis compactage.
2. Cible trop petite sautée avec le journal demandé.
3. Chaîne épuisée : 429 + chaque 400 dans le message, `cause` et `details` ; parole Lisa dédiée.
4. Une annonce utilisateur par bascule et au retour ; rien si flag off.
5. `CODEBUDDY_LLM_FAILOVER` alias déprécié, un seul chemin.
6. Suite exigée 2789 verts / 1 rouge préexistant (liens `file://` de l'étude OmniRoute).
7. `tsc --noEmit` 0 ; eslint `--quiet` 0 ; `git diff --check` 0.
8. Live 4b EXIT 0 avec `[fallback]` ; live ctx32k bascule OK, stall 120 s ensuite.
9. Ouvert : stall du 27B local ; l'agent headless ancre `file_search` sur la racine du dépôt.
10. Aucun push. `~/code-buddy` et `~/.codebuddy` non écrits. ComfyUI 8188/8189 intacts.
