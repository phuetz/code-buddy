# MISSION R26 — Réparation Catalogue Groq & Cerebras (02/09/2026)

## 1. Contexte & Problème
Le catalogue Groq dans Code Buddy annonçait des modèles dépréciés / morts (`llama-3.3-70b-versatile`, `llama-3.1-8b-instant`, `mixtral-8x7b-32768`) causant des erreurs `404 The model does not exist` lors d'appels réels.
Mise à jour requise avec le catalogue vivant au 02/09/2026 :
- **Groq** : `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `qwen/qwen3.8-27b` (défaut), `qwen/qwen3.6-27b`, `groq/compound`, `groq/compound-mini`, `whisper-large-v3`...
- **Cerebras** : `gpt-oss-120b` (vivant confirmé en premier et par défaut), `zai-glm-4.7` (à confirmer), `gemma-4-31b` (à confirmer).

## 2. Modifications Réalisées
1. **Catalogue des fournisseurs (`src/providers/provider-catalog.ts`)** :
   - Mise à jour de l'entrée `groq` : `defaultModel: 'qwen/qwen3.8-27b'`, `models: ['qwen/qwen3.8-27b', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.6-27b', 'groq/compound', 'groq/compound-mini', 'whisper-large-v3']`.
   - Mise à jour de l'entrée `cerebras` : `defaultModel: 'gpt-oss-120b'`, `models: ['gpt-oss-120b', 'zai-glm-4.7', 'gemma-4-31b']`.
2. **Plugin Groq (`src/plugins/bundled/groq-provider.ts`)** :
   - Mise à jour de `KNOWN_MODELS` avec les modèles vivants et leurs fenêtres contextuelles (131 072 pour Qwen/GPT-OSS, 128 000 pour Compound).
   - Mise à jour du `wizard.modelPicker` pour préférer `qwen/qwen3.8-27b`.
   - Mise à jour du modèle par défaut pour `chat()`.
3. **Schéma d'environnement (`src/config/env-schema.ts`)** :
   - `GROQ_MODEL` par défaut fixé à `'qwen/qwen3.8-27b'`.
   - `CEREBRAS_MODEL` par défaut fixé à `'gpt-oss-120b'`.
4. **Configuration des outils et contextes (`src/config/model-tools.ts`)** :
   - Entrée `compound*` ajoutée avec fenêtre de 128 000 tokens, support raisonnement et tool calls.
   - Les entrées nues `gpt-oss-120b` et `gpt-oss-20b` sont couvertes par `gpt-oss-*` (131 072 tokens) et validées avec `bareModelName`.
5. **Presets et configurations Cowork (`cowork/src/shared/api-model-presets.ts`, `cowork/src/main/config/config-store.ts`)** :
   - Mise à jour de la liste de modèles et des placeholders pour Groq.
6. **Tests unitaires (`tests/plugins/extra-providers.test.ts`, `tests/utils/provider-detector.test.ts`, `tests/config/model-tools-gateway-prefix.test.ts`)** :
   - Adaptation des tests pour les nouveaux modèles vivants.
   - Ajout de tests pour `compound*`, `groq/compound`, `groq/compound-mini`, `gpt-oss-120b`, `gpt-oss-20b`.

## 3. État et Audit des modèles Cerebras
- `gpt-oss-120b` : **Confirmé vivant** (premier dans la liste et modèle par défaut).
- `zai-glm-4.7` : **À confirmer** (conservé dans la liste, appel API live non autorisé en environnement de test sans clé).
- `gemma-4-31b` : **À confirmer** (conservé dans la liste, appel API live non autorisé en environnement de test sans clé).

## 4. Preuves de Validation
- Tests ciblés `npx vitest run tests/providers/provider-catalog.test.ts tests/plugins/extra-providers.test.ts tests/utils/provider-detector.test.ts tests/config/model-tools-gateway-prefix.test.ts` : **4 passed (90 tests passed)**.
- Tests complets `tests/providers/` + `tests/config/` : **37 passed (537 tests passed)**.
- Vérification statique des types : `npm run typecheck` vert.
