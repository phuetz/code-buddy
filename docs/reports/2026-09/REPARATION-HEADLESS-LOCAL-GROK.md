# Réparation HEADLESS-LOCAL — voie « $0 locale » de `buddy -p` avec Ollama hors 11434

## État initial

- Statut : **vert** après correctifs.
- Worktree : `~/DEV/cb-headless-2026-09-06`
- Branche : `fix/headless-local-2026-09-06`
- HEAD de départ : `4901d75e4`
- Source : `docs/audits/2026-09-06-audit-installateur-inconnu-opus.md` §A-2, §A-4, §A-5, §B-6
- HOME QA : `~/DEV/cb-headless-2026-09-06/_qa/hl/home` (gitignoré)
- Ollama : `OLLAMA_HOST=http://127.0.0.1:11435` — modèles `qwen3.8-ctx32k:latest` et `qwen3:4b-instruct` uniquement
- Original `~/code-buddy` et `~/.codebuddy` interdits. Aucun push. Aucun `ollama pull`.

## Mesures de l'audit (AVANT)

| Mesure | Valeur |
| --- | --- |
| `buddy -p "haiku"` | 14 min 27, exit 0, sortie **vide** |
| TTFT | 863 560 ms |
| Tokens prompt | 5 604 |
| Cause A-4 | `url.includes(':11434')` en 5 endroits → `/v1`, `content` vide pour un modèle thinking |
| Cause A-5 | anti-stall 120 s pendant l'évaluation du prompt |

## Correctifs

### A-4 — routage du transport natif Ollama

`isOllamaEndpoint(baseUrl, env)` unique :

1. `CODEBUDDY_PROVIDER=ollama` → vrai
2. l'origine de l'URL est celle d'`OLLAMA_HOST` / `OLLAMA_BASE_URL` → vrai
3. hôte loopback **et** sonde `GET /api/tags` 200 ≤ 300 ms dont le JSON a un tableau `models` (mémorisée par origine) → vrai
4. sinon faux ; un `CODEBUDDY_PROVIDER` autre qu'`ollama` court-circuite (LM Studio / vLLM restent en `/v1`)

Les cinq tests `:11434` de `provider-openai-compat.ts` + la fonction historique sont remplacés. Un 200 OpenAI-compat sur loopback n'est plus pris pour Ollama.

### A-2 — réponse finale vide = échec + `think:false`

- Après retrait de `<think>` (et de l'enveloppe « réponse vide du fournisseur »), `-p` écrit sur stderr `le modèle n'a rien renvoyé ; provider=… modèle=… durée=…s` et exit ≠ 0.
- Ollama `/api/chat` : `think:false` pour un modèle thinking en one-shot sans outils (ou `CODEBUDDY_HEADLESS=true`). API récente : `think` boolean.

### A-5 — anti-stall et prompt compact

- 120 s **après** le premier token. Avant : `max(120 s, tokensPrompt × CODEBUDDY_LOCAL_PROMPT_MS_PER_TOKEN)` (défaut 200 ms/token), plafond `CODEBUDDY_STALL_MAX_MS` (défaut 20 min).
- `-p` local : prompt compact (sections optionnelles retirées, RAG ≤ 8 outils, budget système 1 500 tokens). Opt-out `CODEBUDDY_PROMPT_COMPACT=false`.

### B-6 — retour visuel

Sur TTY, stderr `évaluation du prompt… (n s)` toutes les 10 s tant qu'aucun token n'est arrivé. Rien si stdout n'est pas un TTY ou `--quiet` (`CODEBUDDY_QUIET=true`).

## Mesure AVANT / APRÈS (une requête « Écris un haïku sur la mer », `qwen3.8-ctx32k:latest`)

| | Tokens prompt | TTFT | Durée mur | Exit | Sortie |
| --- | ---: | ---: | ---: | ---: | --- |
| AVANT (audit) | 5 604 | 863 560 ms | 14 min 27 | 0 | vide |
| APRÈS | 2 462 | 242 904 ms | 252 s | 0 | « L'écume murmure — le sel trace des sillages, l'horizon s'éloigne. » |

Budget système compact : 55 415 → 9 670 caractères (1 500 tokens). Coût `$0.0000`.

## Essais réels

```
CODEBUDDY_PROVIDER=ollama OLLAMA_HOST=http://127.0.0.1:11435 GROK_MODEL=qwen3.8-ctx32k:latest
node dist/index.js -p "Écris un haïku sur la mer"
```

- `qwen3.8-ctx32k:latest` — 252 314 ms, exit 0, haïku ci-dessus, 2 462 in / 17 out
- `qwen3:4b-instruct` — 37 392 ms, exit 0, « Vagues dans la nuit, / Mer qui respire le vent, / Silence des mers. », 2 462 in / 24 out

## Preuves

- `npx vitest run tests/codebuddy tests/cli tests/services tests/agent/execution tests/security/donnees-personnelles.test.ts` — **65 fichiers / 771 verts / 0 rouge**
- `npx tsc --noEmit -p tsconfig.json` — 0
- `npx eslint . --ext .js,.jsx,.ts,.tsx --quiet` — 0 erreur
- `git diff --check` — 0

## Commits

- A-4 `1eeb2e3f9` `fix(ollama): router le transport natif hors du port 11434`
- A-2 `9246d7dc0` `fix(cli): traiter une reponse headless vide comme un echec`
- B-6 `e52fb2df1` `feat(cli): indicateur TTY evaluation du prompt en -p`
- A-5 `1d587cf9b` `fix(local): stall adaptatif et prompt compact pour -p`

## Bilan

A-4/A-2/A-5/B-6 fermés. `buddy -p` sur 11435 rend un haïku, exit 0, $0. Compact et stall adaptatif rendent la voie locale viable (TTFT 863 s → 243 s). Reste : le premier `buildSystemPrompt` du constructeur est encore tronqué après coup (le tour LLM voit déjà le prompt compact). Aucun push.
