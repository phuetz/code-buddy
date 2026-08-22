# Livecheck des fournisseurs gratuits OmniRoute — 2026-08-22

Test réalisé le `2026-08-22T11:55:47.110Z` (UTC), depuis `/home/patrice/code-buddy-vitrine`, sur les 24 fournisseurs importés et le gateway local `omniroute`. Chaque cible a reçu `GET <defaultBaseURL>/models` sans en-tête d’autorisation, puis avec `Authorization: Bearer test`. Timeout par appel : 10 s ; quatre fournisseurs au maximum en parallèle ; aucune clé réelle utilisée.

Le tableau ci-dessous reprend la dernière exécution ciblée. La colonne HTTP est dans l’ordre `sans clé / Bearer test`.

| id | baseURL | statut | code HTTP | note |
|---|---|---|---|---|
| `omniroute` | `http://localhost:20128/v1` | `reachable-open` | `200 / 200` | 115 modèles retournés par le gateway, sans clé et avec `Bearer test`. |
| `ai21` | `https://api.ai21.com/studio/v1` | `error` | `410 / 410` | HTTP 410 dans les deux essais ; le registre confirme la même racine `/studio/v1`, sans alternative de modèles. |
| `ant-ling` | `https://api.ant-ling.com/v1` | `reachable-auth` | `401 / 401` | Endpoint répondant et clé exigée ; baseURL plausible. |
| `cerebras` | `https://api.cerebras.ai/v1` | `reachable-auth` | `403 / 401` | Endpoint répondant ; refus sans clé puis avec la fausse clé. |
| `cohere` | `https://api.cohere.com/compatibility/v1` | `reachable-auth` | `401 / 401` | Endpoint répondant et clé exigée ; baseURL plausible. |
| `deepinfra` | `https://api.deepinfra.com/v1/openai` | `reachable-open` | `200 / 401` | JSON sans clé : 185 ids de modèles ; la fausse clé reçoit 401. Liste complète dans la sortie `--json`. |
| `featherless-ai` | `https://api.featherless.ai/v1` | `not-found` | `404 / 404` | `/models` absent dans les deux essais ; voir la correction probable ci-dessous. |
| `friendliai` | `https://api.friendli.ai/serverless/v1` | `reachable-open` | `200 / 200` | IDs JSON : `zai-org/GLM-5.2`, `google/gemma-4-31B-it`, `MiniMaxAI/MiniMax-M2.5`, `LGAI-EXAONE/K-EXAONE-2.0-750B-A37B`, `deepseek-ai/DeepSeek-V3.2`, `zai-org/GLM-5.1`. |
| `hyperbolic` | `https://api.hyperbolic.xyz/v1` | `reachable-auth` | `401 / 401` | Endpoint répondant et clé exigée ; baseURL plausible. |
| `inception` | `https://api.inceptionlabs.ai/v1` | `reachable-open` | `200 / 200` | ID JSON : `mercury-2`. |
| `inference-net` | `https://api.inference.net/v1` | `reachable-open` | `200 / 401` | JSON sans clé : 42 ids de modèles ; la fausse clé reçoit 401. Liste complète dans la sortie `--json`. |
| `internlm` | `https://chat.intern-ai.org.cn/api/v1` | `reachable-auth` | `401 / 401` | Endpoint répondant et clé exigée ; baseURL plausible. |
| `liquid` | `https://inference.liquid.ai/v1` | `reachable-auth` | `403 / 401` | Endpoint répondant ; le registre documente explicitement `/v1/models`, 403 sans clé est cohérent. |
| `longcat` | `https://api.longcat.chat/openai/v1` | `reachable-auth` | `401 / 401` | Endpoint répondant et clé exigée ; baseURL plausible. |
| `modelscope` | `https://api-inference.modelscope.cn/v1` | `reachable-open` | `200 / 200` | JSON sans clé : 46 ids de modèles ; liste complète dans la sortie `--json`. |
| `nscale` | `https://inference.api.nscale.com/v1` | `reachable-auth` | `401 / 401` | Endpoint répondant et clé exigée ; baseURL plausible. |
| `openadapter` | `https://api.openadapter.in/v1` | `reachable-auth` | `401 / 401` | Endpoint répondant et clé exigée ; baseURL plausible. |
| `pioneer` | `https://api.pioneer.ai/v1` | `reachable-open` | `200 / 200` | JSON sans clé : 166 ids de modèles ; liste complète dans la sortie `--json`. |
| `reka` | `https://api.reka.ai/v1` | `reachable-auth` | `400 / 401` | Endpoint répondant ; 400 sans clé est non standard, mais 401 avec la fausse clé confirme le chemin d’authentification. |
| `sambanova` | `https://api.sambanova.ai/v1` | `reachable-open` | `200 / 200` | IDs JSON : `DeepSeek-V3.1`, `DeepSeek-V3.2`, `Meta-Llama-3.3-70B-Instruct`, `MiniMax-M2.7`, `MiniMax-M3`, `gemma-4-31B-it`, `gpt-oss-120b`. |
| `sarvam` | `https://api.sarvam.ai/v1` | `reachable-open` | `200 / 200` | IDs JSON : `sarvam-105b`, `sarvam-105b-conversations`. |
| `scaleway` | `https://api.scaleway.ai/v1` | `reachable-auth` | `401 / 403` | Endpoint répondant ; clé exigée, puis refus de la fausse clé. |
| `tokenrouter` | `https://api.tokenrouter.com/v1` | `reachable-auth` | `401 / 401` | Endpoint répondant et clé exigée ; une exécution antérieure a répondu 400/401, sans changer cette conclusion. |
| `typhoon` | `https://api.opentyphoon.ai/v1` | `reachable-open` | `200 / 200` | IDs JSON : `typhoon-v2.5-30b-a3b-instruct`, `typhoon-ocr-v1.5`, `typhoon-ocr`, `typhoon-ocr-preview`, `typhoon-asr-realtime`, `typhoon-isan-asr-realtime`. |
| `zenmux` | `https://zenmux.ai/api/v1` | `reachable-open` | `200 / 200` | JSON sans clé : 164 ids de modèles ; liste complète dans la sortie `--json`. |

## Correction probable pour les réponses problématiques

Lecture seule du registre OmniRoute : `/home/patrice/.nvm/versions/node/v24.14.1/lib/node_modules/omniroute/open-sse/config/providers/registry/`.

- `featherless-ai` : `registry/featherless-ai/index.ts` déclare `baseUrl: "https://api.featherless.ai/v1/chat/completions"`, ce qui confirme que `https://api.featherless.ai/v1` est la bonne racine déjà présente dans `provider-catalog.ts`. Le registre ne déclare aucun `modelsUrl` dédié. Correction probable : ne pas remplacer le `defaultBaseURL`; considérer plutôt `/models` comme non exposé et utiliser la liste statique du registre ou une vérification de `chat/completions` authentifiée. Aucun changement n’a été fait dans `provider-catalog.ts`.
- Aucun résultat `dns` n’a été observé, donc aucune correction de nom d’hôte ne peut être proposée.
- `ai21` renvoie 410, pas 404 : le registre confirme `https://api.ai21.com/studio/v1/chat/completions`, mais ne fournit pas de nouvelle URL. Il serait spéculatif de corriger le catalogue sur ce seul test.

## Commandes pour rejouer

Depuis la racine du dépôt :

```bash
node scripts/providers/livecheck-free-providers.mjs
node scripts/providers/livecheck-free-providers.mjs --json
```

La sortie Markdown affiche le tableau ; `--json` renvoie `checkedAt`, les 25 résultats, les deux observations HTTP, et les ids JSON récupérés pour les réponses 200. Le test porte uniquement sur `GET /models` : il ne prouve ni qu’une clé réelle fonctionne, ni qu’un modèle peut générer, ni qu’un palier gratuit est encore disponible.

## Bilan

- 25 cibles contrôlées : 24 fournisseurs gratuits importés et le gateway OmniRoute local.
- 11 sont `reachable-open`, dont OmniRoute avec 115 modèles listés.
- 12 sont `reachable-auth`, donc leurs endpoints répondent mais exigent une authentification.
- 2 restent douteux au sens du classement : `ai21` (410) et `featherless-ai` (404 sur `/models`).
- Aucun DNS n’a échoué ; aucun appel n’a utilisé de clé réelle.
- `reka` (400/401) et `tokenrouter` (réponses 400/401 puis 401/401 selon l’essai) sont joignables mais méritent une vérification avec une vraie clé.
- Les quotas gratuits, l’authentification réelle et la génération n’ont pas pu être vérifiés sans clé.
- Un premier essai du script avant le correctif de périmètre a interrogé quatre placeholders hors mission (`custom`, `azure`, `bedrock`, `copilot`) ; uniquement en GET et sans clé, résultats écartés du présent rapport.
