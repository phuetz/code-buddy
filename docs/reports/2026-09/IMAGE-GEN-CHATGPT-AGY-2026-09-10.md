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

*(En cours d'investigation)*

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
