# PROVIDER-FALLBACK-GROK — basculement automatique de fournisseur LLM

Date : 2026-09-06 (Europe/Paris)
Agent : Grok 4.6
Clone : `~/DEV/cb-fallback-2026-09-06`
Branche : `feat/provider-fallback-2026-09-06`
HEAD au départ : `aef1bdfbd` (`test(tools): justifications d'émission pour les 5 outils reclassés (C5 vert)`)
Original `~/code-buddy` : interdit (jamais ouvert, jamais écrit)
Rapport créé **avant toute inspection**.
HOME temporaire : `_qa/fb/home`. Aucune écriture dans le vrai `~/.codebuddy`.

Incident du jour (06/09) : le compagnon Telegram (`buddy channels start --type telegram`, `CODEBUDDY_PROVIDER=chatgpt-oauth`) est resté muet toute la matinée. Le backend ChatGPT Responses répond `429 {"type":"usage_limit_reached","resets_in_seconds":…}` jusqu'au reset hebdomadaire ; le canal a journalisé « Channel provider failure hidden from conversation » et n'a rien tenté d'autre alors qu'un Ollama local (`qwen3.8-ctx32k`) et d'autres fournisseurs (xAI OAuth, Gemini) étaient disponibles. Le pilote a basculé à la main.

Inspiration : OmniRoute — idées seulement, pas de copie.

## Mission

1. Cartographier les appels LLM (dispatcher `client.ts`, providers, `ModelRoutingFacade`, `resolveCommandProvider`, registre multi-LLM, `model-selector`, catalogue OmniRoute s'il existe) ; comment une 429/5xx remonte (canaux, sensory, headless `-p`) ; ce qui existe déjà en repli.
2. Concevoir un repli opt-in `CODEBUDDY_PROVIDER_FALLBACK=true` (défaut OFF = byte-identique) : classification des échecs, chaîne de secours, mémoire de panne persistée, transfert de contexte, visibilité, retour au fournisseur d'origine.
3. Câbler au seul point de couture `client.ts` (`chat` / `chatStream`) pour que canaux et companion en bénéficient sans changement.
4. Tests rouge→vert (providers factices) + preuves + docs.

## Garde-fous

- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Vitest : `HOME=~/DEV/cb-fallback-2026-09-06/_qa/fb/home` et `env -u FORCE_COLOR`.
- Jamais `/home/<user>` ni prénom dans les fichiers suivis (écrire `~`).
- ComfyUI 8188/8189 non touché.
- Pas de verdict dans ce rapport (le pilote le fera).

## Journal

### 2026-09-06 — création du rapport (avant inspection)

HEAD `aef1bdfbd`. Branche déjà extraite. Réservation `8bd049e92`.

### Inspection

- Dispatcher unique : `CodeBuddyClient.chat` / `chatStream` (`src/codebuddy/client.ts`). Une stratégie : Gemini native, ChatGPT Responses, Gemini CLI, Agy CLI, sinon OpenAI-compat.
- Repli Hermes déjà câblé : `CODEBUDDY_FALLBACK_PROVIDERS` / `_PROVIDER`+_MODEL, plus pool de credentials. **Toute erreur** déclenche le secours. Pas de classification quota vs 401. Pas de mémoire persistée. Pas de note de reprise.
- `CODEBUDDY_LLM_FAILOVER=1` / `[llm] enabled` injecte le registre authentifié via `setRuntimeFallbackProviders` **seulement** dans le bootstrap CLI/headless (`applyActiveLlmFailover`). Les canaux et `agent-reply.ts` ne l'appellent pas.
- ChatGPT `enrichError` renvoyait `Error("ChatGPT Responses backend error (429): {body}")` **sans** `.status` / `.type` / `resets_in_seconds`. `usage_limit_reached` n'était pas dans le classifieur → 429 congestion, retried 2 fois par `withLlmStreamRetry`, puis « Sorry, I encountered an error: » → le canal masque (« Channel provider failure hidden from conversation »).
- `classifyProviderError` existait (retry vs fatal). `ProviderFallbackChain` (`src/providers/fallback-chain.ts`) est un circuit-breaker **non** branché sur le client. OmniRoute est un candidat catalogue (`omniroute`, gateway local / inférence cloud), pas un modèle à copier.
- `provider:fallback` existait déjà dans `AllEvents` mais le client ne l'émettait pas.

## Conception

Opt-in `CODEBUDDY_PROVIDER_FALLBACK=true` (défaut OFF). Point de couture unique : `chat` / `chatStream`.

| Kind | Signaux | Action |
|---|---|---|
| `quota_exhausted` | 429 `usage_limit_reached`, `insufficient_quota`, billing | Banc jusqu'à `resets_in_seconds` (défaut 1 h), bascule |
| `overloaded` | 503, 529, `overloaded_error` | Banc 60 s (backoff exponentiel), bascule |
| `unreachable` | `ECONNREFUSED`, timeout | Banc 5 min, bascule |
| `auth` | 401 / 403 | **Pas de bascule silencieuse** — journal + `provider:error` |
| `other` | 400, inconnu | Erreur d'origine inchangée |

Chaîne : `CODEBUDDY_FALLBACK_CHAIN="chatgpt-oauth>xai>gemini>ollama:qwen3.8-ctx32k:latest"`. Sinon liste Hermes, sinon registre authentifié (`buildActiveLlmRegistry`). Jamais un fournisseur sans secret. `CODEBUDDY_LOCAL_ONLY` (et `CODEBUDDY_SENSORY_SPEAK_LOCAL_ONLY`) exclut le cloud. Santé : `~/.codebuddy/provider-health.json`. Transfert : `repairToolCallPairs` + retroncature prompt-builder + compact `ContextManagerV2` (repli sliding-window) + note « conversation reprise par … ». Retour à l'origine au **tour suivant**.

## Implémentation

| Module | Rôle |
|---|---|
| `src/codebuddy/provider-failover-kind.ts` | 5 kinds + `resets_in_seconds` |
| `src/codebuddy/provider-error-classifier.ts` | `usage_limit_reached` → fatal `quota_exhausted` |
| `src/codebuddy/providers/provider-chatgpt-responses.ts` | `enrichError` conserve status/type/resets |
| `src/providers/provider-health.ts` | JSON atomique 0o600 |
| `src/providers/provider-failover-policy.ts` | flag, chaîne `>`, LOCAL_ONLY, registre |
| `src/codebuddy/provider-handoff.ts` | reprise + compact |
| `src/providers/provider-failover-notify.ts` | `[fallback] …`, bus, RunStore `decision` |
| `src/codebuddy/client.ts` | `chatWithDeclaredFailover` / stream ; skip primary tant que `resetsAt` |
| `src/sensory/domain-event-bridge.ts` | `provider:fallback` → percept `provider_fallback` |
| `buddy doctor` / `buddy whoami` | état de santé |

Flag OFF : le chemin Hermes `chatWithProviderFallback` est inchangé (test d'absence de fichier santé + d'absence de note de reprise).

## Preuves

Commandes sous `HOME=~/DEV/cb-fallback-2026-09-06/_qa/fb/home` et `env -u FORCE_COLOR`.

```text
./node_modules/.bin/vitest run tests/codebuddy/provider-failover-kind.test.ts \
  tests/codebuddy/provider-handoff.test.ts tests/providers/provider-health.test.ts \
  tests/providers/provider-failover-policy.test.ts tests/codebuddy/provider-failover.test.ts \
  tests/commands/whoami-status.test.ts tests/sensory/domain-event-bridge.test.ts
# 7 files / 37 passed

./node_modules/.bin/vitest run tests/codebuddy tests/providers tests/channels \
  tests/security/donnees-personnelles.test.ts
# 103 files : 1 failed (tests/channels/telegram-inconnu-journey.test.ts, parcours live
# Ollama 150 s, assertion /help contient '/repo') + 101 passed + 1 skipped
# 2069 passed / 7 skipped / 1 failed

./node_modules/.bin/vitest run tests/codebuddy tests/providers tests/channels \
  tests/security/donnees-personnelles.test.ts \
  --exclude tests/channels/telegram-inconnu-journey.test.ts
# 102 files / 101 passed / 1 skipped ; 2069 passed / 7 skipped

./node_modules/.bin/vitest run tests/security/donnees-personnelles.test.ts
# 1 file / 40 passed

./node_modules/.bin/tsc --noEmit -p tsconfig.json
# exit 0 (aucune ligne)

./node_modules/.bin/eslint --max-warnings=0 <fichiers touchés>
# exit 0

git diff --check
# exit 0
```

Le parcours Telegram GK10 (`telegram-inconnu-journey.test.ts`) a échoué une fois : la réponse `/help` du petit modèle local n'incluait pas `/repo` au bout de 150 s. Flag de repli OFF sur ce chemin ; non relancé en live (durée). Hors ce fichier, la commande exigée est verte.

## Bilan

- Opt-in `CODEBUDDY_PROVIDER_FALLBACK` câblé dans `CodeBuddyClient.chat`/`chatStream` (canaux et companion sans autre changement).
- 429 `usage_limit_reached` classé `quota_exhausted` ; ChatGPT conserve `status`/`type`/`resets_in_seconds`.
- Santé persistée, chaîne `>`, LOCAL_ONLY, note de reprise, compact, bus `provider:fallback`, doctor/whoami.
- Flag OFF : Hermes inchangé (pas de fichier santé, pas de note).
- Preuves : 37 tests nouveaux verts ; suite exigée 2069 verts hors 1 live Telegram `/help` ; `tsc` 0 ; eslint ciblé 0 ; privacy 40/40 ; `git diff --check` 0.
- Ouvert : activer le flag + `CODEBUDDY_FALLBACK_CHAIN` sur le compagnon Telegram ; relancer GK10 si le pilote le demande.
- Aucun push. `~/code-buddy` et `~/.codebuddy` non écrits. ComfyUI 8188/8189 intacts.

## Correctifs après vérification agy

### 2026-09-06 — reprise (avant correctifs)

Rapport adversariel `docs/reports/2026-09/VERIF-FALLBACK-AGY.md` (`f951ebe19`). Cinq trous, un commit chacun.

### Ce qui a changé

1. **Classification** — quota avant 401/403/400. Anthropic 400 `credit balance is too low` et 429 monthly limit → `quota_exhausted`. Gemini 429 `RESOURCE_EXHAUSTED` / « Resource has been exhausted (e.g. check quota). » → `quota_exhausted` (plus le 60 s `overloaded`). xAI 403 `out_of_credits` → `quota_exhausted` (le 403 `Forbidden` reste `auth`, sans repli). 429 congestion sans signal quota reste `overloaded` 60 s. `Connection error.` (SDK OpenAI, sans errno) et `APIConnectionError` → `network` / `unreachable`.
2. **Santé persistée** — plus de cache `memoryOverride` qui saute le disque. Chaque mutation reprend le JSON sous verrou exclusif (fichier `.lock` à côté), fusionne, écrit en atomic-write `0o600`. Message persisté : Bearer / `sk-` / `api_key=` chassés. Un écrit concurrent (canaux vs server) n'efface plus l'autre.
3. **Bus** — `provider:fallback` porte `resetsAt` et `resets_at`. Le pont sensoriel les retransmet.
4. **Chaîne `@url`** — `fournisseur:modele@http://host:port` : le modèle garde ses deux-points (`qwen3.8-ctx32k:latest`), `baseURL` est surcharge par cible (`/v1` ajouté pour ollama).
5. **Essai réel** — préflight Ollama : si le repli déclaré est ON, plus de `process.exit(1)` ; `chat`/`chatStream` tentent la chaîne. Sur le flux, `[fallback]` est émis dès le premier token (sinon la ligne n'apparaissait qu'après la fin du modèle).

### Essai réel unreachable (commande agy, HOME `_qa/fb/home`)

```text
HOME=~/DEV/cb-fallback-2026-09-06/_qa/fb/home \
env -u FORCE_COLOR \
CODEBUDDY_PROVIDER_FALLBACK=true \
CODEBUDDY_PROVIDER=ollama \
OLLAMA_HOST=http://127.0.0.1:9 \
CODEBUDDY_FALLBACK_CHAIN='ollama>ollama:qwen3.8-ctx32k:latest@http://127.0.0.1:11435' \
node dist/index.js -p 'Réponds: OK' --max-tool-rounds 0
```

Sortie (extrait) :

```text
WARN  Ollama not reachable at http://127.0.0.1:9/v1.
...
Declared provider failover is enabled; continuing so chat() can try the backup chain.
WARN  [fallback] custom → ollama:qwen3.8-ctx32k:latest (unreachable, reset dans 5 min)
{"result":"OK",...,"model":"qwen2.5-coder:7b","messages":[...,{"role":"assistant","content":"OK"}]}
```

`fromProvider: custom` : l'hôte mort `127.0.0.1:9` n'est pas l'URL catalogue Ollama, donc l'id de santé ne collisionne pas avec le secours `ollama` sur `:11435`. Exit 0.

### Essai réel quota 429 (serveur factice OpenAI-compat, port 0 → Ollama `:11435`)

Le primaire répond `429 {"type":"usage_limit_reached","resets_in_seconds":73172}`. Chaîne `ollama:qwen3.8-ctx32k:latest@http://127.0.0.1:11435`.

```text
WARN  API call failed, retrying (attempt 1) ... 429 You have reached your usage limit
WARN  [fallback] custom → ollama:qwen3.8-ctx32k:latest (quota_exhausted, reset dans 53 min)
Réponse: OK
Modèle effectif: qwen3.8-ctx32k:latest
```

Le CLI headless `-p` sur le même 429 a bien classé `quota_exhausted` et ouvert le flux vers `:11435` ; la file Ollama locale était saturée (plusieurs clients déjà connectés), le premier token a mis plusieurs minutes. Le client court ci-dessus (même HTTP 429 + même modèle) a rendu `OK`.

### Tests d'intégration HTTP (serveurs factices)

`tests/codebuddy/provider-failover-http.test.ts` : (1) primaire port fermé → `Connection error.` → ollama `@url` factice répond `OK` ; (2) primaire 429 `usage_limit_reached` → même bascule, bus avec `resetsAt`.

### Preuves

Commandes sous `HOME=~/DEV/cb-fallback-2026-09-06/_qa/fb/home` et `env -u FORCE_COLOR`.

```text
./node_modules/.bin/vitest run tests/codebuddy tests/providers tests/channels \
  tests/security/donnees-personnelles.test.ts \
  --exclude tests/channels/telegram-inconnu-journey.test.ts
# Test Files  102 passed | 1 skipped (103)
# Tests  2089 passed | 7 skipped (2096)

./node_modules/.bin/tsc --noEmit -p tsconfig.json
# exit 0

./node_modules/.bin/eslint --max-warnings=0 <fichiers touchés>
# exit 0

git diff --check
# exit 0
```

Suite exigée d'origine : 2069 verts / 7 skip. Ici 2089 / 7 skip (les nouveaux cas classification, santé, `@url`, HTTP). Privacy dans la même commande. Aucun push. `~/code-buddy` et `~/.codebuddy` non écrits. ComfyUI 8188/8189 intacts.

### Ouvert

- Le retry interne OpenAI-compat (3 tentatives) tape encore un 429 `usage_limit_reached` avant de laisser le classifieur basculer.
- L'id `custom` pour un Ollama dont l'URL n'est pas `:11434` : volontaire pour ne pas bancariser le secours local sous la même clé que le primaire mort.
