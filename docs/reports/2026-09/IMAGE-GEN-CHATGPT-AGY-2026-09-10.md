# Rapport de mission AGY — Fournisseur d'images `chatgpt` (backend Codex, gpt-image-2)

- Date : 2026-09-10
- Branche : `agy/image-gen-chatgpt-2026-09-10`
- Dépôt : `code-buddy-imagegen-2026-09-10`
- Pilote / Agent : Antigravity (AGY)
- Mission : Intégration du fournisseur d'images `chatgpt` ($0, backend Codex `gpt-image-2`) dans Code Buddy

---

## 1. Objectifs de la mission

1. **Protocole Codex CLI (`image_gen`, `gpt-image-2`)** :
   - Analyser le protocole utilisé par Codex CLI (`codex-rs` sur `https://github.com/openai/codex` ou inspection locale / capture).
   - Déterminer la déclaration d'outil dans `/responses` (`image_gen`, `type`, paramètres) et le format de retour (base64, URL, item).
   - Noter les extraits exacts et le commit source.
2. **Implémentation Code Buddy** :
   - Nouveau `MediaProvider = 'chatgpt'` (en plus de `openai | xai | fal | comfyui`).
   - Réutilisation de l'authentification et des en-têtes Codex depuis `src/codebuddy/providers/provider-chatgpt-responses.ts` (factorisation via fonction partagée).
   - Support `generateImage` et `editImage` (image en entrée dans `input`).
   - Sidecar `.meta.json` : `provider: 'chatgpt'`, `model: 'gpt-image-2'`.
   - Résolution automatique (`resolveImageProvider`) : `chatgpt` si explicite ou si pas de clé API OpenAI/xAI mais auth Codex présente. Erreurs lisibles.
   - Préservation stricte du comportement existant avec clés OpenAI/xAI.
3. **Tests et Validation** :
   - Tests unitaires `tests/tools/media-generation-chatgpt.test.ts` avec mock fetch.
   - Test LIVE activable via `CODEBUDDY_LIVE_CHATGPT_IMAGE=true` écrivant un vrai PNG sous `.codebuddy/media-generation/` (lecture directe de l'auth sans copie de fichiers de clés).
   - `npm run typecheck`, `npm run lint`, `npm test -- tests/tools/media-generation`.
4. **Documentation** :
   - `CLAUDE.md` et `docs/`.

---

## 2. Protocole Codex CLI et extraits

### 2.1 Contexte et dépôts inspectés

- **Dépôt source inspecté** : `https://github.com/openai/codex` (`codex-rs`)
- **Commit HEAD lu** : `9e552e9d15ba52bed7077d5357f3e18e330f8f38` (« Use available width for skill names in the toggle view (#32485) »)
- **Commit clé d'évolution du protocole d'outils** : `a7c72aee8b385486746bfc2b48f5158a47526804` (« Use the image generation extension by default (#31596) »)
- **Version Codex CLI de référence** : `codex-cli 0.153.0` (exécutable local @ `/home/patrice/.nvm/versions/node/v24.14.1/lib/node_modules/@openai/codex`)

---

### 2.2 Analyse des deux architectures d'outils image

L'analyse approfondie du code source Rust (`codex-rs`) et les tests réels contre l'infrastructure ChatGPT/Codex révèlent l'existence et le fonctionnement de deux mécanismes complémentaires :

#### Architecture A : Outil intégré (hosted tool) dans `/responses` (`type: "image_generation"`)

Dans la requête `POST https://chatgpt.com/backend-api/codex/responses` :
- L'outil est déclaré directement dans le tableau `tools` :
```json
{
  "tools": [
    { "type": "image_generation" }
  ]
}
```
- Le corps de la requête impose :
  - `model`: un modèle conversationnel servable par le backend Codex (ex. `gpt-5.6-sol`, `gpt-5.5` ou `CHATGPT_OAUTH_DEFAULT_MODEL` de Code Buddy).
  - `store`: `false` (obligatoire pour le backend ChatGPT/Codex).
  - `stream`: `true` (obligatoire).
  - `input`: tableau d'items message. Pour la génération, un message utilisateur contenant `input_text`. Pour l'édition d'image : le message utilisateur contient à la fois le texte d'instruction (`input_text`) et l'image source sous forme d'élément `input_image` avec son URL data base64 :
```json
{
  "model": "gpt-5.6-sol",
  "store": false,
  "stream": true,
  "instructions": "You are an image generation agent...",
  "input": [
    {
      "type": "message",
      "role": "user",
      "content": [
        { "type": "input_text", "text": "Change the square to vibrant green" },
        { "type": "input_image", "image_url": "data:image/png;base64,..." }
      ]
    }
  ],
  "tools": [
    { "type": "image_generation" }
  ]
}
```

- Dans le flux SSE reçu de `/responses`, la génération déclenche les événements :
  1. `response.output_item.added` (`item.type === "image_generation_call"`, `status: "in_progress"`)
  2. `response.image_generation_call.in_progress`
  3. `response.image_generation_call.generating`
  4. `response.image_generation_call.completed`
  5. `response.output_item.done` avec le payload complet :
```json
{
  "type": "response.output_item.done",
  "item": {
    "id": "ig_0e62f7e120456862016aa296ae4c8c87d2a610e0dcbba9609e",
    "type": "image_generation_call",
    "status": "completed",
    "revised_prompt": "A single perfectly circular solid red dot, centered on a clean pure white background...",
    "result": "iVBORw0KGgoAAAANSUhEUgAABOYAA..."
  }
}
```
L'image revient donc directement encodée en base64 PNG dans `item.result`, accompagnée du `revised_prompt`.

#### Architecture B : Endpoints HTTP directs du backend Codex (`images/generations` et `images/edits`)

Codex CLI 0.153 implémente également une extension (`codex_image_generation_extension`, `ext/image-generation/src/tool.rs`) qui déclare l'outil comme une fonction namespacée :
```json
{
  "type": "namespace",
  "name": "image_gen",
  "description": "Image generation and editing tools",
  "tools": [
    {
      "type": "function",
      "name": "imagegen",
      "description": "The image_gen.imagegen tool enables image generation...",
      "parameters": {
        "type": "object",
        "properties": {
          "prompt": { "type": "string" },
          "referenced_image_paths": { "type": "array", "items": { "type": "string" }, "maxItems": 5 },
          "num_last_images_to_include": { "type": "integer", "minimum": 1, "maximum": 5 }
        },
        "required": ["prompt"]
      }
    }
  ]
}
```
Lorsque le modèle invoque `image_gen.imagegen`, l'exécuteur du CLI (`CodexImagesBackend` dans `ext/image-generation/src/backend.rs` et `codex-api/src/endpoint/images.rs`) effectue un appel HTTP POST direct vers :
- Génération : `POST https://chatgpt.com/backend-api/codex/images/generations`
- Édition : `POST https://chatgpt.com/backend-api/codex/images/edits`
Avec modèle `gpt-image-2`, en-têtes OAuth Codex (`Authorization: Bearer <token>`, `ChatGPT-Account-ID`, `originator: codex_cli_rs`, `x-codex-installation-id`), et corps JSON :
```json
{
  "prompt": "a red circle on white background",
  "model": "gpt-image-2"
}
```
Réponse (200 OK) :
```json
{
  "created": 1789040081,
  "background": "opaque",
  "data": [
    {
      "b64_json": "iVBORw0KGgoAAAANSUhEUg...",
      "generation_id": "..."
    }
  ],
  "output_format": "png",
  "quality": "medium",
  "size": "1024x1024"
}
```

### 2.3 Preuves réelles capturées

Les deux flux ont été testés et validés en conditions réelles avec le compte ChatGPT Pro actif :
1. Appel direct `/images/generations` : 200 OK, image PNG générée de 1 223 988 octets en base64 en ~16 s.
2. Appel direct `/images/edits` : 200 OK, image PNG éditée de 1 392 844 octets en base64 en ~20 s.
3. Appel `/responses` avec `{ type: 'image_generation' }` : 200 OK, item `image_generation_call` retourné en SSE avec base64 de 824 104 octets en ~25 s.
4. Édition `/responses` avec image en entrée dans `input` (`input_image` + `input_text`) : 200 OK, item `image_generation_call` retourné en SSE avec base64 de 1 419 328 octets en ~30 s.


---

## 3. Implémentation et modifications

### 3.1 Architecture retenue

L'implémentation adopte l'Architecture A (`/responses` avec outil `image_generation` hébergé par le backend Codex), complétée par la compatibilité directe avec les endpoints `/images/generations` si une URL personnalisée est spécifiée.

### 3.2 Fichiers modifiés et créés

1. **`src/codebuddy/providers/chatgpt-headers.ts` (nouveau)** :
   - Extrait les en-têtes standard Codex (`buildChatGptHeaders`) depuis `provider-chatgpt-responses.ts`.
   - Définit les constantes `CODEX_ORIGINATOR = 'codex_cli_rs'` et `CHATGPT_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'`.
   - Évite toute duplication de code d'authentification entre le fournisseur chat et le fournisseur d'images.

2. **`src/providers/codex-oauth.ts`** :
   - Ajout d'un repli en lecture seule vers `~/.codex/auth.json` dans `hasCodexCredentials()` et `getChatGptAuth()`.
   - Permet d'exploiter les identifiants existants de la session ChatGPT Codex en place sans nécessiter de copie de fichier d'authentification (ce qui risquerait d'invalider le token par rotation).

3. **`src/tools/media-generation-tool.ts`** :
   - Type étendu : `MediaProvider = 'openai' | 'xai' | 'fal' | 'comfyui' | 'chatgpt'`.
   - Export de l'interface `ProviderConfig`.
   - Priorités de sélection dans `resolveImageProvider` :
     1. Explicite : `CODEBUDDY_IMAGE_PROVIDER=chatgpt`.
     2. Explicite : `openai`, `xai`, `fal`, `comfyui`.
     3. Auto-détection ComfyUI (si `COMFYUI_URL` ou URLs de repli présentes).
     4. Auto-détection ChatGPT : si aucune clé `OPENAI_API_KEY`, `XAI_API_KEY` ou `FAL_KEY` n'est définie et que des identifiants Codex valides existent (`hasCodexCredentials()`).
     5. Repli par défaut historique : `openai` (préservé à l'octet près).
   - Validation `assertProviderReady` :
     - Pour `chatgpt`, vérifie la présence d'identifiants valides. En leur absence, retourne un message d'erreur clair :
       `No ChatGPT credentials found for provider chatgpt. Run buddy login (or /login chatgpt) to connect.`
   - Fonctions dédiées ChatGPT :
     - `generateChatGptImage` : prépare le prompt avec indication d'aspect (`square 1:1`, `landscape 3:2`, `portrait 2:3`), appelle le backend Codex via `/responses`, sauvegarde le fichier PNG dans `.codebuddy/media-generation/images/` et génère le sidecar `.meta.json` standard (`provider: 'chatgpt'`, `model: 'gpt-image-2'`).
     - `editChatGptImage` : injecte l'image source dans `input_image` et la consigne de modification dans `input_text` avec délimitation des régions normalisées.
     - `executeChatGptResponsesImage` : gère la requête HTTP, le rafraîchissement automatique de token sur 401 via `refreshChatGptAuth()` avec retry, et la gestion explicite des erreurs 429 (rate limit).
     - `parseChatGptImageResponse` : extrait le base64 PNG et le `revised_prompt` depuis le flux d'événements SSE (`image_generation_call`) ou une réponse JSON directe.
   - `getImageEditCapabilities` : expose `provider: 'chatgpt'`, `available: true`, `alphaMasking: false`.

4. **`tests/tools/media-generation-chatgpt.test.ts` (nouveau)** :
   - 14 tests unitaires avec mock fetch couvrant :
     - Format de requête envoyé à `/responses` (headers, body, tools: `[{ type: 'image_generation' }]`, model, aspect ratio).
     - Parsing de réponse SSE et JSON direct.
     - Retry automatique sur 401 après rafraîchissement de jeton.
     - Gestion d'erreur 429 avec message lisible.
     - Édition d'image avec élément `input_image` et `selections`.
     - Résolution de fournisseur : auto-détection, explicite, non-régression quand `OPENAI_API_KEY` est présent.
     - Capacités d'édition d'image.
   - 1 test d'intégration réel (live) :
     - Conditionné par `CODEBUDDY_LIVE_CHATGPT_IMAGE=true` et la présence de credentials.
     - Génération d'une vraie image par `gpt-image-2` (« A small red cube on white background »).
     - Vérification de l'existence du fichier PNG, de sa taille (> 1000 octets), de sa signature magique PNG et du sidecar `.meta.json`.

5. **`CLAUDE.md` & `docs/configuration.md`** :
   - Documentation de `CODEBUDDY_IMAGE_PROVIDER=chatgpt`, des règles d'auto-détection, du modèle effectif `gpt-image-2`, du sidecar `.meta.json` et de la variable `CODEBUDDY_CHATGPT_IMAGE_TIMEOUT_MS`.

---

## 4. Preuves de validation et tests

### 4.1 Test Live en conditions réelles

- **Commande exécutée** : `CODEBUDDY_LIVE_CHATGPT_IMAGE=true npx vitest run tests/tools/media-generation-chatgpt.test.ts`
- **Résultat** : 15/15 tests passés en 28.58 s.
- **Fichier image généré** :
  - Chemin : `.codebuddy/media-generation/images/image-1789041421498-94b26447-e402-4beb-9d41-fc4286d852c4.png`
  - Taille : 798 559 octets (~798 Ko, > 1000 octets requis)
  - Caractéristiques vérifiées via `file` :
    `PNG image data, 1254 x 1254, 8-bit/color RGB, non-interlaced`
  - Sidecar `.meta.json` associé :
    ```json
    {
      "kind": "image",
      "prompt": "A small red cube on white background",
      "revisedPrompt": "A single small red cube centered on a clean pure white background, minimalist studio product image, subtle soft shadow beneath the cube, crisp geometric edges, realistic lighting, no text, no other objects, square 1:1 composition.",
      "provider": "chatgpt",
      "model": "gpt-image-2",
      "aspect_ratio": "square",
      "generatedAt": "2026-09-10T11:56:32.284Z"
    }
    ```

### 4.2 Suites de validation globales

1. **Vérification des types (`npm run typecheck`)** :
   - `tsc --noEmit` : 0 erreur
   - `tsc --project tsconfig.gpuNode-identity.json` : 0 erreur
   - `tsc --noEmit -p packages/companion-core/tsconfig.json` : 0 erreur
2. **Linter (`npx eslint`)** :
   - Exécuté sur tous les fichiers modifiés / créés : 0 erreur.
3. **Tests de non-régression média (`npx vitest run tests/tools/media-generation`)** :
   - 3 fichiers de tests, 18 tests exécutés : 17 passés, 1 skippé (live test quand variable d'env non activée).
4. **Tests dédiés avec Live (`CODEBUDDY_LIVE_CHATGPT_IMAGE=true npx vitest run tests/tools/media-generation-chatgpt.test.ts`)** :
   - 15/15 tests passés (100 % vert).

---

## 5. Outillage, historique git et fraîcheur d'index

### 5.1 Commits de la mission

- `ed4f36a5e` : `docs: initialisation du rapport de mission image-gen chatgpt`
- `1fb6bd25d` : `docs(report): protocole codex cli pour gpt-image-2 et endpoints backend`
- `c5762c02e` : `refactor(chatgpt): extraction des en-têtes partagés et support repli lecture codex-auth`
- `42600cdcc` : `feat(image-gen): support fournisseur chatgpt (backend codex gpt-image-2)`
- `a290ef7a5` : `test(tools): tests unitaires et live pour media-generation chatgpt`
- `98842a3e0` : `docs: documentation de CODEBUDDY_IMAGE_PROVIDER=chatgpt`
- `a8bcd3d5a` : `fix(image-gen): ajustements linter et nettoyage des imports provider-chatgpt`

### 5.2 Fraîcheur d'index Code Explorer

Indexation incrémentale (`code-explorer analyze . --incremental`) exécutée avec succès après chaque commit. Graphe et snapshot synchronisés.

---

## 6. Verdict final

VERDICT: protocole TROUVÉ ; LIVE PNG OUI ; tests 15/15
