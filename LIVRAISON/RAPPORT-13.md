# Mission Grok n° 13 — Qwen3.6-35B-A3B (Lemonade) modèle flotte par défaut

**STATUT : PARTIEL** — correctif, tests, paquet et docs livrés ; recette agent A/B non rejouée : Lemonade `POST /api/v1/load` et `POST /api/v1/chat/completions` pendent 0 octet (GET `/health` et `/models` répondent). Cause exacte : backend LLM Lemonade coincé derrière le tunnel `127.0.0.1:13305` ; le superviseur doit le relancer / basculer ROCm.

Branche : `fable/peer-tool-invoke-2026-09-16`
Worktree : `/home/patrice/DEV/cb-peer-tool-invoke-2026-09-16`
HEAD de départ : `e1e353b58`
PR : https://github.com/phuetz/code-buddy/pull/155

## 1. Diagnostic (fichier:ligne)

Hypothèse prioritaire **réfutée** pour `supportsToolCalls`. `matchModel` (`src/config/model-tools.ts:1182`) compile déjà le glob avec le flag `/i`. Avant correctif :

| Nom | Motif | `supportsToolCalls` | `promptProfile` | Fenêtre |
|---|---|---|---|---|
| `Qwen3.6-35B-A3B-MTP-GGUF` | `qwen3.6*` (`:452`) | **true** | *(standard)* | 262144 / 32768 out |
| `gemma4:12b` (recette 8 OK) | `gemma4*` | true | **lite** | 32768 / 4096 |

Les outils **n’étaient pas retirés** par `supportsToolCalls === false`. Le nom GGUF héritait du plafond **hébergé** 262k sans profil `lite`. Dans la boucle agent (mission 8) : 72 461 tokens in, 9× `bash` (`list_peers` en shell), zéro `peer_tool_invoke`.

Second suspect (OpenAI-compat) : `useTools = !isLocalInference() && tools.length` (`provider-openai-compat.ts` `chat` / `chatStream`). `isLocalInference()` (`:601`) :

- `FUNCTION_CALLING_MODELS` **ne contenait pas** `qwen3` (seulement `qwen2.5`) — `:270`.
- Lemonade `:13305` n’est **pas** classé local (`:1234` / lmstudio seulement) → **tools + `tool_choice: auto` étaient déjà envoyés** sur 13305.
- Sur un port LM Studio, Qwen3.6 aurait perdu `tools`. Correctif : `'qwen3'` dans `FUNCTION_CALLING_MODELS` ( `includes('qwen3')` couvre 3.5/3.6/3.8). Journal : `CODEBUDDY_LOG_LLM_TOOLS=true` → ligne `[openai-compat] chat tools payload`.

Cause boucle agent : surface trop large (profil standard 262k) + `bash` avant les outils flotte dans `alwaysInclude`. Gemma réussissait parce que `promptProfile: 'lite'` (max 5 + flotte).

## 2. Correctif

- Entrée **avant** `qwen3.6*` : `Qwen3.6-*-GGUF*` (`model-tools.ts`), casse-insensible, `supportsToolCalls: true`, `promptProfile: 'lite'`, 32k / 8k out. Les ids OpenRouter/Ollama `qwen3.6:35b-…` restent sur `qwen3.6*`.
- `FUNCTION_CALLING_MODELS` + `'qwen3'` ; log payload tools.
- Outils flotte **en tête** de `alwaysInclude` (`agent-executor.ts`) quand un pair est enregistré.

## 3. Vérifications

| Commande | Résultat |
|---|---|
| `env -u FORCE_COLOR npx vitest run tests/config tests/tools tests/fleet` | **272 fichiers / 2992 verts / 1 skip / 0 rouge**, 93,94 s |
| `npx tsc --noEmit -p tsconfig.json` | exit 0, 20,35 s |
| ESLint `--quiet` fichiers touchés | exit 0 |
| `git diff --check` | 0 |

Tests ciblés : `tests/config/model-tools-qwen36-gguf.test.ts`, payload Lemonade dans `provider-openai-compat.test.ts`, ordre `alwaysInclude` dans `agent-executor.test.ts`.

## 4. Paquet

- `npm run build` + `npm pack` → `phuetz-code-buddy-2.1.0.tgz` (npm shasum `037503548733a63261fb1036d45f8742f7c1a07a`, SHA256 `8e985440016a431f8608179456d83d1f51fcb956cf63626c88ac1af9dd7aad44`)
- Réinstall : `npm install --prefix ~/.local/share/code-buddy-fleet/20260916-b/prefix <tgz> --no-save`
- Grep préfixe : `model: 'Qwen3.6-*-GGUF*'` présent.

## 5. Recette A/B + ROCm

`results-13.json` : `oracleInAResponse=false`, `toolUsedByA=[]`, `errors=["AbortError: This operation was aborted"]` (timeout load 180 s).

Preuves Lemonade **après** abort :

- `GET /api/v1/health` → `status=ok`, `model_loaded=null`, `all_models_loaded=[]`, version `11.7.0`. **Pas de `device` / `recipe`** (aucun LLM chargé) → ROCm vs Vulkan **non observable**.
- `GET /api/v1/models` → 7 ids dont `Qwen3.6-35B-A3B-MTP-GGUF` (`recipe: llamacpp`) **et** `gemma4-it-e4b-FLM` / `llama3.1-8b-FLM` (absents du banc 8).
- `POST /api/v1/unload` → `{"status":"success"}` immédiat.
- `POST /api/v1/load` (Qwen3.6 180 s puis 300 s ; Llama-3.2-1B 90 s) → **0 octet**, curl 28.
- `POST /api/v1/chat/completions` (1B, 8 tokens, 90 s) → **0 octet**.

Le tunnel GET fonctionne ; le chemin LLM (load/chat) est coincé. **tok/s non mesuré** (pas de `timings`). Relance Lemonade / bascule ROCm = superviseur.

Recette agent (prompt neutre, ≤ 3 formulations, oracle, négatifs, panne/reprise) **non exécutée** faute de modèle chargé.

## 6. Docs

Section « Modèle par défaut recommandé : Qwen3.6-35B-A3B (Lemonade) » dans `docs/fleet-guide.md` : env exactes + repli `gemma4:12b` @ `OLLAMA_HOST=http://127.0.0.1:11435`.

## 7. Push / checks

À remplir après `git push origin fable/peer-tool-invoke-2026-09-16` (non forcé) et `gh pr checks 155`.
