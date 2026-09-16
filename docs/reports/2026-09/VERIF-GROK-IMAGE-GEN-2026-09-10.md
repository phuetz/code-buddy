# Vérification GROK — fournisseur d'images `chatgpt` (10/09/2026)

- Date : 2026-09-10
- Agent : Grok 4.6 (xAI)
- Clone : `code-buddy-imagegen-2026-09-10`
- Branche : `agy/image-gen-chatgpt-2026-09-10`
- HEAD vérifié : `83f3cd953` (9 commits au-dessus de `origin/main`)
- Rapport source agy : `docs/reports/2026-09/IMAGE-GEN-CHATGPT-AGY-2026-09-10.md`
- Contrainte : aucun fichier de code modifié ; ce rapport est le seul livrable
- Index Code Explorer : INDEXED sur `83f3cd953` (status CLI à jour) ; `analyze . --force` relancé car le MCP de session répondait « Repository not found »

## Diff `origin/main..HEAD`

```
 CLAUDE.md                                          |   1 +
 docs/configuration.md                              |  12 +-
 docs/reports/2026-09/IMAGE-GEN-CHATGPT-AGY-2026-09-10.md | 284 +
 src/codebuddy/providers/chatgpt-headers.ts         |  48 +
 src/codebuddy/providers/provider-chatgpt-responses.ts |  34 +-
 src/providers/codex-oauth.ts                       |  17 +-
 src/tools/media-generation-tool.ts                 | 429 +
 tests/tools/media-generation-chatgpt.test.ts       | 376 +
 8 files changed, 1164 insertions(+), 37 deletions(-)
```

`git diff --check origin/main..HEAD` : 0.

---

## 1. Auth, fuites, sélection automatique

### 1.1 Auth Codex : lecture seule de `~/.codex/auth.json`

- `loadAuthFile` / `hasCodexCredentials` lisent d'abord `~/.codebuddy/codex-auth.json`, puis **en repli lecture** `~/.codex/auth.json` (ajout de cette branche).
- `saveAuthFile` n'écrit **que** `~/.codebuddy/codex-auth.json` (mode 0600). Aucun `write*` vers `~/.codex/auth.json`.
- Le chemin image appelle `getChatGptAuth()` (rafraîchit si `last_refresh` > 1 h) et, sur HTTP 401, `refreshChatGptAuth()` — qui **peut** réécrire `codex-auth.json` (rotation IdP). Ce n'est pas une écriture de `auth.json` Codex CLI.
- **Live** (génération réelle + sonde `model`) : mtimes et tailles inchangés
  - `~/.codebuddy/codex-auth.json` : 13:56:32 +0200, 5388 octets (avant = après)
  - `~/.codex/auth.json` : 03/09 16:58, 4219 octets (avant = après)
- Aucune copie de ces fichiers ailleurs.

Résidu (pas déclenché ici) : si le primaire Code Buddy est absent et que le repli Codex CLI fournit le refresh token, un 401 ferait tourner le jeton chez l'IdP puis l'écrirait seulement dans `codex-auth.json`, laissant le fichier Codex CLI périmé. Non observé : le primaire existait et n'était pas stale.

### 1.2 Fuite de jeton

| Surface | Jeton ? | Preuve |
| --- | --- | --- |
| Sidecar `.meta.json` | non | Live : `kind`, `prompt`, `revisedPrompt`, `provider`, `model`, `aspect_ratio`, `generatedAt` uniquement |
| En-têtes HTTP | oui, `Authorization: Bearer …` vers l'API (attendu) | `buildChatGptHeaders` ; **non journalisés** sur le chemin image |
| Erreurs | message API `error.message` éventuellement collé (429/!ok) | pas le Bearer ; 401 → texte fixe « `buddy login` » |
| Tests | jetons **factices** (`fake-access-token-123`, `sk-openai-test-key`) | seul `Bearer` du diff |

`logger.error` du refresh (préexistant) n'enregistre que `error.name`.

### 1.3 Sans `CODEBUDDY_IMAGE_PROVIDER` et **avec** `OPENAI_API_KEY`

Chemin historique `openai` conservé.

- Test : `preserves openai provider when OPENAI_API_KEY is present without explicit provider` (suite chatgpt).
- Exécution : `resolveImageProvider({ OPENAI_API_KEY: 'sk-openai-test-key' })` → `provider: openai`, `baseUrl: https://api.openai.com/v1`.
- Sur `origin/main`, l'auto-ComfyUI (si URL) puis `openai`/`xai` ; le `chatgpt` n'est choisi que si `!hasOpenAiKey && !hasXaiKey && !hasFalKey && hasChatGptAuth`. Donc **avec** une clé OpenAI, le graphe rejoint le repli `openai` comme avant.

### 1.4 Auto-sélection et absence d'auth

Ordre réel de `resolveImageProvider` : provider explicite → ComfyUI si `COMFYUI_URL` / `CODEBUDDY_IMAGE_BASE_URL` contenant `8188` / fallbacks → **sinon** `chatgpt` si auth Codex et pas de clés cloud → sinon `openai`/`xai`/`fal`.

- Auto avec auth, sans clé, sans ComfyUI : `chatgpt` / `gpt-image-2` / `https://chatgpt.com/backend-api/codex/responses`. Test + exécution.
- `CODEBUDDY_IMAGE_PROVIDER=chatgpt` sans credentials (processus neuf, `HOME` isolé `_qa/verif-grok-image-gen/home`) :

  `No ChatGPT credentials found for provider chatgpt. Run \`buddy login\` (or \`/login chatgpt\`) to connect.`

- Sans provider **et** sans auth (même HOME isolé) : **pas** « buddy login » — repli historique :

  `No image generation credentials configured for provider openai`

C'est cohérent avec l'auto-sélection (chatgpt n'est proposé que si l'auth est déjà là).

---

## 2. Typecheck, lint, tests

| Commande | Résultat |
| --- | --- |
| `npm run typecheck` | exit 0 (`tsc --noEmit` + gpuNode-identity + companion-core) |
| `npx eslint --quiet` sur les 5 fichiers TS touchés | exit 0 |
| `npm run lint -- <fichiers>` | exit 0 (le script `eslint .` parcourt tout le dépôt ; warnings préexistants, 0 erreur) |
| `npm test -- tests/tools/media-generation` | **3 fichiers / 17 verts / 1 skip** (live gated) / 629 ms |
| `npm test -- tests/tools` | **177 fichiers / 1708 verts / 1 skip** / 21,49 s |
| `npm test -- tests/codebuddy/providers` | **12 fichiers / 167 verts** / 1,65 s |

Le skip unique hors live est le test gated `CODEBUDDY_LIVE_CHATGPT_IMAGE`.

---

## 3. LIVE PNG et Cowork

Commande : `CODEBUDDY_LIVE_CHATGPT_IMAGE=true npm test -- tests/tools/media-generation-chatgpt`

- **15/15 verts** en 22,25 s (le skip live s'est exécuté).
- HOME réel, **aucun** copié de `auth.json` / `codex-auth.json`.
- PNG : `.codebuddy/media-generation/images/image-1789042709820-c27987b5-0606-4644-bb57-548bb03a223d.png`
  - `file` : PNG 1254×1254, RGB 8-bit, non interlaced
  - 783 399 octets, signature `\x89PNG`
  - sidecar `provider: chatgpt`, `model: gpt-image-2`, prompt « A small red cube on white background »
  - **Contenu** : un cube rouge satiné, centré, ombre douce, fond blanc unie (rendu produit minimal).

`.codebuddy/` est gitignoré ; les PNG ne sont pas suivis.

### Cowork / surface média

`MediaGenService.generateImage` copie `process.env` et n'impose `CODEBUDDY_IMAGE_PROVIDER` que si la requête le demande. App Studio (arbre/éditeur) n'appelle pas `generateImage` ; la surface média Cowork si.

Exécution équivalente (env recopié, clés et provider ôtés) :

```
provider=chatgpt  model=gpt-image-2
baseUrl=https://chatgpt.com/backend-api/codex/responses  apiKeyLen=0
```

Dans **cet** environnement d'exécution : `COMFYUI_URL` / `OPENAI_API_KEY` / `XAI_API_KEY` absents → **oui, `chatgpt`**. Si l'Electron Cowork de l'opérateur a `COMFYUI_URL`, ComfyUI gagne (ordre documenté dans `CLAUDE.md`).

---

## 4. Modèle Images 2.5 (`gpt-image-2.5-flare`)

Le backend Codex `/responses` déclare l'outil hosted `{ "type": "image_generation" }` **sans** champ `model`. `CODEBUDDY_IMAGE_MODEL` alimente `config.model` (sidecar) ; le `model` du POST est le modèle **conversationnel** (`gpt-5.6-sol`).

| Essai | Résultat |
| --- | --- |
| Produit, `CODEBUDDY_IMAGE_MODEL=gpt-image-2.5-flare` (live, fetch intercepté) | **Ignoré par l'API** : `tools=[{type:"image_generation"}]`, `model` top-level `gpt-5.6-sol`. Génération **OK** (sphère bleue 1254×1254). Sidecar `model: gpt-image-2.5-flare` (étiquette locale, pas une preuve que Flare a rendu). |
| Sonde hors produit : `tools: [{ type: "image_generation", model: "gpt-image-2.5-flare" }]` | **Accepté** : HTTP 200, PNG 1254×1254 (cône jaune). Le backend Codex **accepte** le champ `model` sur l'outil. |

Doc OpenAI (guide Responses, 08/09/2026) : `tools: [{ type: "image_generation", model: "gpt-image-2.5-sunburst" }]`. Le code livré ne le transmet pas. Non modifié, conformément à la mission.

---

## 5. Hygiène

- `git diff origin/main..HEAD` : **aucun** `/home/…`, aucun jeton réel, aucun identifiant de compte. Seuls des Bearer / `sk-` **de test**.
- `CLAUDE.md` table env : `CODEBUDDY_IMAGE_PROVIDER=chatgpt` documenté (auto-sélection Codex vs clés cloud vs ComfyUI, sidecar, édition `input_image`).
- `docs/configuration.md` idem.

---

## Outillage

- Outillage : **7** appels Code Explorer CLI (4 `context` / 1 `impact` / 2 `query`) + 1 `analyze --force` ; MCP `list_repos` ×2 ; **5** `context`/`query`/`impact` MCP en échec « Repository not found » (index CLI à jour, registre MCP de session non rafraîchi malgré `--force`).
- **7** commandes via `lm-resizer exec` (diff, typecheck, lint, 4 suites test) ; **≈ 503 514 octets** de sortie économisés (lint 450 850 + `tests/tools` 51 548 + le reste).
- Index : à jour sur `83f3cd953` au départ ; réindexé `--force` (MCP) ; incrémental après le commit de ce rapport.

HOME QA `_qa/verif-grok-image-gen/home` (gitignoré) : uniquement la preuve « sans auth ».

---

## Verdict

Le fournisseur `chatgpt` génère un vrai PNG via `/responses` + auth Codex en lecture (fichiers d'auth non mutés sur le live), sans fuite dans le sidecar, avec repli `openai` inchangé dès qu'une `OPENAI_API_KEY` est là, tests et typecheck verts. Limites notées, non bloquantes pour fusionner : `CODEBUDDY_IMAGE_MODEL` n'est pas envoyé à l'outil `image_generation` (pourtant accepté par le backend) ; sans auth et sans provider l'erreur reste celle d'`openai`, pas « buddy login ».

VERDICT: PUSHABLE

===LANE_GROK_VERIF_IMAGE_GEN_TERMINE===
