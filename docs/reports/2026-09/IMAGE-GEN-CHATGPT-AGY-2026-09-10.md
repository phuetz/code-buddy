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

*(En cours)*

---

## 4. Preuves de validation et tests

*(En cours)*

---

## 5. Outillage et fraîcheur d'index

- Outillage : 1 appel Code Explorer (analyze), 1 commande lm-resizer.
- Suivi d'index : initialisé après `code-explorer analyze .`.
