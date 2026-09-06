# Étude à la source : OmniRoute 3.8.49 vs Code Buddy (Failover & Transfert de Contexte)

*Date : 2026-09-06*  
*Auteur : Antigravity (AGY)*  
*Contexte : Mission AGY-OMNIROUTE — Comparaison architecturale et empirique à la source*  
*Worktree : `~/DEV/cb-omniroute-etude-2026-09-06` (branche `etude/omniroute-failover-2026-09-06`)*  
*Source OmniRoute de référence : `~/.nvm/versions/node/v24.14.1/lib/node_modules/omniroute` (v3.8.49)*

---

## 1. Cartographie exhaustive OmniRoute 3.8.49

L'analyse du code source d'OmniRoute v3.8.49 révèle un système de routage et de repli hautement sophistiqué, articulé autour de mécanismes proactifs et réactifs.

### a) Détection des quotas et signaux 429
OmniRoute implémente une détection à deux niveaux : proactive (avant requête) et réactive (après réponse HTTP).
- **Classification fine des 429** : [`src/shared/utils/classify429.ts:21-69`](~/.nvm/versions/node/v24.14.1/lib/node_modules/omniroute/src/shared/utils/classify429.ts#L21-L69)
  - Fonction `classify429(status, body, headers)` : distingue un rate limit passager d'un épuisement fatal de quota (`QUOTA_PATTERNS` incluant `insufficient_quota`, `exceeded your current quota`, `billing`, `credits`).
  - Fonction `parseRetryAfter(header)` : gère les entiers (secondes), les dates HTTP standard, ainsi que les formats textuels propriétaires comme Groq (`"60s"`, `"5m"`).
- **Signaux de crédits épuisés** : [`open-sse/services/accountFallback.ts:175-192`](~/.nvm/versions/node/v24.14.1/lib/node_modules/omniroute/open-sse/services/accountFallback.ts#L175-L192)
  - Constante `CREDITS_EXHAUSTED_SIGNALS` : capture `insufficient_quota`, `quota_exhausted`, `credit_balance_too_low`, `usage_limit_reached`, `rate_limit_exceeded`.
  - Fonction `parseRetryAfterFromBody(body)` : [`open-sse/services/accountFallback.ts:1063-1115`](~/.nvm/versions/node/v24.14.1/lib/node_modules/omniroute/open-sse/services/accountFallback.ts#L1063-L1115) extrait `resets_in_seconds`, `resets_at` et timestamps Unix imbriqués dans les réponses d'erreur JSON.
- **Vérification proactive (Preflight)** : [`open-sse/services/quotaPreflight.ts:21-120`](~/.nvm/versions/node/v24.14.1/lib/node_modules/omniroute/open-sse/services/quotaPreflight.ts#L21-L120)
  - `checkQuotaPreflight(connectionId, model)` : consulte le cache des quotas locaux avant l'envoi. Si une connexion est connue comme épuisée ou si la fenêtre glissante est saturée, la requête est déroutée sans consommer de round-trip réseau.
- **Gestionnaire adaptatif de rate limit** : [`open-sse/services/rateLimitManager.ts:80-115`](~/.nvm/versions/node/v24.14.1/lib/node_modules/omniroute/open-sse/services/rateLimitManager.ts#L80-L115)
  - Utilise des limiteurs `Bottleneck` ajustés dynamiquement d'après les en-têtes amont (`x-ratelimit-remaining-requests`, `x-ratelimit-reset-requests`, `retry-after`).

### b) Ordonnancement de la cascade (Cascade Ordering)
OmniRoute ne se contente pas d'une liste statique ; il applique des stratégies dynamiques d'ordonnancement des cibles :
- **Boucle de sélection et d'essai** : [`open-sse/services/combo.ts:826-1004`](~/.nvm/versions/node/v24.14.1/lib/node_modules/omniroute/open-sse/services/combo.ts#L826-L1004)
  - Méthode `setTry` : itère à travers les cibles du groupe ("combo"), gère le délai entre essais et applique la permutation selon la stratégie active.
- **Stratégies de tri multi-critères** : [`open-sse/services/combo/applyStrategyOrdering.ts:43-240`](~/.nvm/versions/node/v24.14.1/lib/node_modules/omniroute/open-sse/services/combo/applyStrategyOrdering.ts#L43-L240)
  - Supporte 14 modes : `priority`, `weighted`, `strict-random`, `fill-first`, `p2c` (power of two choices), `least-used`, `cost-optimized`, `reset-aware`, `reset-window`, `context-optimized`, `cache-optimized`, `headroom`, `quota-share`, `auto`.
- **Tri au coût** : [`open-sse/services/combo/targetSorters.ts:66-90`](~/.nvm/versions/node/v24.14.1/lib/node_modules/omniroute/open-sse/services/combo/targetSorters.ts#L66-L90)
  - `sortModelsByCost` : interroge la base SQLite locale pour obtenir les prix par million de tokens (`input_cost_per_m`, `output_cost_per_m`) et trie les modèles de repli du moins cher au plus onéreux.
- **Sélection et rotation de connexion** : [`src/sse/services/auth.ts:1509-1661`](~/.nvm/versions/node/v24.14.1/lib/node_modules/omniroute/src/sse/services/auth.ts#L1509-L1661)
  - `selectConnection` : round-robin persistant (sticky) avec pénalité `backoffLevel` pour les clés ayant récemment échoué.

### c) Transfert de contexte et gestion des fenêtres réduites
Lorsqu'un repli s'opère vers un modèle ayant un contexte plus restreint, OmniRoute dispose de mécanismes de synthèse et de compression :
- **Prompt de handoff structuré** : [`open-sse/services/contextHandoff.ts:25-39`](~/.nvm/versions/node/v24.14.1/lib/node_modules/omniroute/open-sse/services/contextHandoff.ts#L25-L39)
  - `HANDOFF_PROMPT_TEMPLATE` : ordonne au modèle de produire un JSON structuré `{summary, keyDecisions, taskProgress, activeEntities}`.
- **Sélection et limitation des messages** : [`open-sse/services/contextHandoff.ts:233-266`](~/.nvm/versions/node/v24.14.1/lib/node_modules/omniroute/open-sse/services/contextHandoff.ts#L233-L266)
  - `selectMessagesForSummary` : bride l'historique transmis pour résumé à 8 000 tokens maximum.
- **Injection du contexte universel** : [`open-sse/services/contextHandoff.ts:478-495`](~/.nvm/versions/node/v24.14.1/lib/node_modules/omniroute/open-sse/services/contextHandoff.ts#L478-L495) et [`724-770`](~/.nvm/versions/node/v24.14.1/lib/node_modules/omniroute/open-sse/services/contextHandoff.ts#L724-L770)
  - `buildUniversalHandoffSystemMessage` et `injectUniversalHandoffBody` : insèrent le résumé dans le prompt système du nouveau modèle cible.
- **Persistance SQLite des handoffs** : [`src/lib/db/contextHandoffs.ts:80-115`](~/.nvm/versions/node/v24.14.1/lib/node_modules/omniroute/src/lib/db/contextHandoffs.ts#L80-L115)
  - Table `context_handoffs` indexée par session / hash de requête, avec un TTL par défaut de 5 heures.
- **Compression de repli proactive** : [`open-sse/services/combo.ts:1100-1129`](~/.nvm/versions/node/v24.14.1/lib/node_modules/omniroute/open-sse/services/combo.ts#L1100-L1129)
  - Active `fallbackCompressionMode` si le modèle cible possède un contexte inférieur à la taille de la requête.
- **Reprise de flux à mi-course (Stream Recovery)** : [`open-sse/services/streamRecovery.ts:38-104`](~/.nvm/versions/node/v24.14.1/lib/node_modules/omniroute/open-sse/services/streamRecovery.ts#L38-L104) et [`174-270`](~/.nvm/versions/node/v24.14.1/lib/node_modules/omniroute/open-sse/services/streamRecovery.ts#L174-L270)
  - `HoldbackBuffer` : temporise les premiers chunks SSE.
  - `scanOpenAiSseText` & `makeContinuationBody` : en cas de coupure réseau, génère un corps de requête injectant le préfixe texte déjà reçu pour continuer la génération.
  - **Règle stricte sur les tool calls** ([ligne 177](~/.nvm/versions/node/v24.14.1/lib/node_modules/omniroute/open-sse/services/streamRecovery.ts#L177)) : `sawToolCall` $\rightarrow$ si un appel d'outil partiel a été détecté dans le flux interrompu, **OmniRoute refuse expressément la reprise partielle** car l'état de l'argument JSON ne peut être garanti.

### d) Rétablissement du fournisseur principal (Primary Recovery)
- **Détection de fin de fenêtre d'épuisement** : [`src/domain/quotaCache.ts:112-125`](~/.nvm/versions/node/v24.14.1/lib/node_modules/omniroute/src/domain/quotaCache.ts#L112-L125)
  - `advancedWindowResetAt` : si `resetMs <= Date.now()`, remet immédiatement à zéro l'état d'épuisement (`exhausted = false`).
- **Décroissance des compteurs d'échec** : [`open-sse/services/accountFallback.ts:763-785`](~/.nvm/versions/node/v24.14.1/lib/node_modules/omniroute/open-sse/services/accountFallback.ts#L763-L785)
  - `decayModelFailureCount` : applique une décroissance exponentielle du niveau d'échec au fil du temps.
- **Vérification de cooldown** : [`open-sse/services/accountFallback.ts:935-948`](~/.nvm/versions/node/v24.14.1/lib/node_modules/omniroute/open-sse/services/accountFallback.ts#L935-L948)
  - `isProviderInCooldown` : contrôle si la période d'isolement est échue avant de réautoriser le dispatch principal.

### e) Mémoire des pannes et TTL
- **Tables SQLite dédiées** :
  - `quota_snapshots` ([`src/lib/db/quotaSnapshots.ts`](~/.nvm/versions/node/v24.14.1/lib/node_modules/omniroute/src/lib/db/quotaSnapshots.ts))
  - `quota_reset_events` ([`src/lib/db/quotaResetEvents.ts`](~/.nvm/versions/node/v24.14.1/lib/node_modules/omniroute/src/lib/db/quotaResetEvents.ts))
  - `provider_connections` colonnes `rateLimitedUntil` et `backoffLevel`.
- **Circuit breaker à mémoire partagée** : persistance synchronisée entre mémoire volatile et SQLite pour survivre aux redémarrages du daemon OmniRoute.

### f) Observabilité
- **En-têtes HTTP de décision** : [`src/domain/omnirouteResponseMeta.ts:83-190`](~/.nvm/versions/node/v24.14.1/lib/node_modules/omniroute/src/domain/omnirouteResponseMeta.ts#L83-L190)
  - `X-OmniRoute-Provider` : identifiant du fournisseur ayant répondu.
  - `X-OmniRoute-Model` : modèle effectif.
  - `X-OmniRoute-Decision` : raison de la décision (ex. `fallback_after_429`).
  - `X-OmniRoute-Fallback-Attempts` : nombre d'essais préalables infructueux.
  - `X-OmniRoute-Latency-Ms` : durée totale incluant les tentatives avortées.
- **Commentaires SSE pour flux temps réel** : [`src/domain/omnirouteResponseMeta.ts:192-201`](~/.nvm/versions/node/v24.14.1/lib/node_modules/omniroute/src/domain/omnirouteResponseMeta.ts#L192-L201)
  - `buildOmniRouteSseMetadataComment` : émet `: omniroute-meta: {...}` directement dans le flux SSE.

### g) Moteurs de compression RTK et Caveman
- **RTK (Runtime Toolkit / Shell log deduplication)** : [`open-sse/services/compression/engines/rtk/`](~/.nvm/versions/node/v24.14.1/lib/node_modules/omniroute/open-sse/services/compression/engines/rtk/)
  - Détecte les sorties de commandes de build ou logs redondants et applique un diff condensé.
- **Caveman (Condensation sémantique)** : [`open-sse/services/compression/caveman.ts`](~/.nvm/versions/node/v24.14.1/lib/node_modules/omniroute/open-sse/services/compression/caveman.ts)
  - Élimine le bavardage conversationnel ("Sure, I can help with that...") pour maximiser le token-headroom avant fallback.

---

## 2. Cartographie de Code Buddy (Architecture actuelle)

Code Buddy a intégré aujourd'hui une cascade déclarative opt-in pilotée par variables d'environnement.

### a) Détection des erreurs et classification
- **Classificateur d'erreurs** : [`src/codebuddy/provider-error-classifier.ts:11-93`](~/DEV/cb-omniroute-etude-2026-09-06/src/codebuddy/provider-error-classifier.ts#L11-L93)
  - `classifyProviderError` : analyse les statuts HTTP (429, 402, 403, 503, 529), les messages textuels et les en-têtes `Retry-After`.
- **Typologie des pannes** : [`src/codebuddy/provider-failover-kind.ts:24-95`](~/DEV/cb-omniroute-etude-2026-09-06/src/codebuddy/provider-failover-kind.ts#L24-L95)
  - 5 catégories : `quota_exhausted`, `overloaded`, `unreachable`, `auth`, `other`.
  - `extractResetsInSeconds` : extrait `resets_in_seconds` et `resets_at` depuis le JSON de retour de ChatGPT/Codex.

### b) Ordonnancement de la cascade
- **Chaîne déclarative** : [`src/providers/provider-failover-policy.ts:24-170`](~/DEV/cb-omniroute-etude-2026-09-06/src/providers/provider-failover-policy.ts#L24-L170)
  - `CODEBUDDY_PROVIDER_FALLBACK=true` active la politique.
  - `CODEBUDDY_FALLBACK_CHAIN='chatgpt>ollama:qwen3:4b-instruct@http://127.0.0.1:11435'` est parsée par `parseFallbackChain`.
  - Ordonnancement : strictement séquentiel et statique d'après la déclaration de l'utilisateur.
  - *Note d'architecture* : Code Buddy possède un sous-système distinct historique dans [`src/providers/active-llm-registry.ts`](~/DEV/cb-omniroute-etude-2026-09-06/src/providers/active-llm-registry.ts) et [`src/index.ts:698-740`](~/DEV/cb-omniroute-etude-2026-09-06/src/index.ts#L698-L740) (`applyActiveLlmFailover`, `CODEBUDDY_LLM_FAILOVER=1`, politiques `resilience`, `free-first`, `manual`), coexistant avec `CODEBUDDY_PROVIDER_FALLBACK`.

### c) Transfert de contexte et adaptation
- **Préparation des messages** : [`src/codebuddy/provider-handoff.ts:22-130`](~/DEV/cb-omniroute-etude-2026-09-06/src/codebuddy/provider-handoff.ts#L22-L130)
  - `repairToolCallPairs` : supprime les `tool_call` orphelins (sans bloc de réponse `tool` correspondant) ou les réponses `tool` isolées pour éviter les rejets de schéma par le LLM suivant.
  - `retruncateSystemPrompt` : réajuste le prompt système selon les plafonds de tokens du modèle de repli.
  - `compactMessagesForModelAsync` : applique la fenêtre glissante via `ContextManagerV2.prepareMessagesRaw`.
  - `buildResumeNote` : injecte une balise informative `<provider_resume>conversation reprise par [provider] suite à [kind]...</provider_resume>`.
  - **Limitation identifiée** : voir Section 4 — le tableau complet `tools` (définitions d'outils) n'est pas compressé ni élagué lors du handoff.
  - **Flux interrompu à mi-course** : [`src/codebuddy/client.ts:1012-1024`](~/DEV/cb-omniroute-etude-2026-09-06/src/codebuddy/client.ts#L1012-L1024)
    - `yieldedAnyChunk` : si au moins un chunk a été émis vers le consommateur, le repli est interdit et une exception est levée afin de garantir l'intégrité de la réponse et d'éviter les réponses hybrides.

### d) Rétablissement du fournisseur principal
- **Vérification de disponibilité** : [`src/codebuddy/client.ts:549-556`](~/DEV/cb-omniroute-etude-2026-09-06/src/codebuddy/client.ts#L549-L556) (`maybeReturnToOriginal`)
  - Lors de chaque nouveau tour, consulte `isProviderUnavailable(primaryId)`.
  - Si l'horodatage `resetsAt` est dépassé (`resetsAt <= Date.now()`), le fournisseur principal est automatiquement réactivé et testé en priorité.

### e) Mémoire des pannes et TTL
- **Stockage fichier atomique** : [`src/providers/provider-health.ts:20-160`](~/DEV/cb-omniroute-etude-2026-09-06/src/providers/provider-health.ts#L20-L160)
  - Persistance dans `~/.codebuddy/provider-health.json` (permissions 0600) protégé par un fichier `.lock`.
  - Structure :
    ```json
    {
      "version": 1,
      "providers": {
        "chatgpt": {
          "kind": "quota_exhausted",
          "message": "ChatGPT Responses backend error (429): ...",
          "failedAt": 1788718093927,
          "resetsAt": 1788747920927,
          "lastModel": "gpt-5.6-sol"
        }
      }
    }
    ```

### f) Observabilité
- **Notifications console** : [`src/providers/provider-failover-policy.ts:180-196`](~/DEV/cb-omniroute-etude-2026-09-06/src/providers/provider-failover-policy.ts#L180-L196)
  - `notifyProviderFallback` : affiche un avertissement clair en sortie terminal :  
    `WARN [fallback] chatgpt → ollama:qwen3:4b-instruct (quota_exhausted, reset dans 8 h)`
  - Pas d'en-tête HTTP structuré ou de canal dédié d'événement UI pour le companion Lisa.

---

## 3. Tableau d'écarts détaillé

| Fonctionnalité | Présent dans Code Buddy ? | Taille estimée | Fichiers cibles dans Code Buddy | Description & Différence clé avec OmniRoute |
| :--- | :---: | :---: | :--- | :--- |
| **1. Bascule proactive avant 429** | **Non** | **M** | `src/codebuddy/client.ts`<br>`src/providers/provider-health.ts`<br>`src/providers/provider-failover-policy.ts` | OmniRoute inspecte `quotaPreflight` et Bottleneck avant envoi. Code Buddy ne bascule que de manière réactive après le premier échec HTTP (sauf si `resetsAt` est déjà consigné dans `provider-health.json`). |
| **2. Ordonnancement au coût** | **Partiel** | **S** | `src/providers/provider-failover-policy.ts`<br>`src/providers/provider-catalog.ts` | OmniRoute interroge une table SQLite des coûts par token (`sortModelsByCost`). Code Buddy respecte l'ordre statique de `CODEBUDDY_FALLBACK_CHAIN`. Un tri automatique `free-first` (local d'abord) existe dans `active-llm-registry.ts` mais n'est pas unifié dans la chaîne déclarative. |
| **3. Reprise de flux coupé à mi-course** | **Non** (Choix d'intégrité) | **L** | `src/codebuddy/client.ts`<br>`src/agent/execution/agent-executor.ts` | OmniRoute dispose de `HoldbackBuffer` et tente une continuation en injectant le prétexte texte généré (uniquement si aucun tool call n'a été émis). Code Buddy applique une règle de non-hybridation stricte : dès qu'un chunk est émis, il avorte. |
| **4. Transfert d'outils & élagage des définitions** | **Partiel** (Goulot critique) | **M** | `src/codebuddy/provider-handoff.ts`<br>`src/codebuddy/client.ts` | Code Buddy répare parfaitement les paires de messages `tool_call` / `tool` orphelines. **Cependant**, il transmet l'intégralité du tableau `tools` (60k+ tokens) au modèle de repli, faisant exploser la fenêtre de contexte des modèles locaux (ex. Ollama 32k) avec une erreur 400. |
| **5. Visibilité utilisateur / Notification Lisa** | **Partiel** | **S** | `src/channels/companion-channel-turn.ts`<br>`src/providers/provider-failover-policy.ts` | OmniRoute injecte des métadonnées SSE et en-têtes `X-OmniRoute-*`. Code Buddy émet un log console et injecte `<provider_resume>`, mais ne notifie pas le canal companion ni Lisa de manière interactive. |
| **6. Reprise automatique sur `resets_at`** | **Oui** | **S** (Fait) | `src/codebuddy/client.ts`<br>`src/providers/provider-health.ts` | Entièrement opérationnel : `extractResetsInSeconds` calcule l'expiration, stockée dans `provider-health.json`, et `maybeReturnToOriginal` réactive le primaire dès expiration. |

---

## 4. Essai réel Code Buddy (Isolation `_qa/omni/home`)

Un banc d'essai isolé a été mis en œuvre dans l'environnement du worktree pour éprouver le comportement avec un compte réel OpenAI/Codex dont le quota hebdomadaire était épuisé.

### Configuration du test
- **Répertoire utilisateur isolé** : `~/DEV/cb-omniroute-etude-2026-09-06/_qa/omni/home/.codebuddy/`
- **Fichier d'authentification** : `codex-auth.json` (recopié depuis `~/.codebuddy/codex-auth.json` en mode lecture seule).
- **Fournisseur principal** : `CODEBUDDY_PROVIDER=chatgpt` (authentification OAuth Codex, modèle `gpt-5.6-sol`).
- **Fournisseur de repli** : Ollama local (`127.0.0.1:11435`, modèle `qwen3:4b-instruct`).
- **Variables d'environnement** :
  ```bash
  HOME=~/DEV/cb-omniroute-etude-2026-09-06/_qa/omni/home
  CODEBUDDY_PROVIDER=chatgpt
  CODEBUDDY_PROVIDER_FALLBACK=true
  CODEBUDDY_FALLBACK_CHAIN='chatgpt>ollama:qwen3:4b-instruct@http://127.0.0.1:11435'
  ```

### Résultat 1 : Test direct de flux client (`CodeBuddyClient.chatStream`)
Lors de l'appel direct au client sans enregistrement d'outils, la détection du 429 et la bascule vers Ollama s'exécutent avec succès en **1,2 seconde** :
```text
[2026-09-06T18:13:09.190Z] ⚠️ WARN  [fallback] chatgpt → ollama:qwen3:4b-instruct (quota_exhausted, reset dans 8 h) {
  "source": "CodeBuddyClient",
  "fromProvider": "chatgpt",
  "toProvider": "ollama",
  "toModel": "qwen3:4b-instruct",
  "kind": "quota_exhausted",
  "resetsAt": 1788747920927
}
Coucou ! 😊
Success without tools!
```

### Résultat 2 : Persistance de l'état de santé (`provider-health.json`)
Le fichier `provider-health.json` est immédiatement généré et consigné de manière atomique :
```json
{
  "version": 1,
  "providers": {
    "chatgpt": {
      "kind": "quota_exhausted",
      "message": "ChatGPT Responses backend error (429): {\"error\":{\"type\":\"usage_limit_reached\",\"message\":\"The usage limit has been reached\",\"plan_type\":\"pro\",\"resets_at\":1788747920,\"eligible_promo\":null,\"resets_in_seconds\":29827}}",
      "failedAt": 1788718093927,
      "resetsAt": 1788747920927,
      "lastModel": "gpt-5.6-sol"
    }
  }
}
```
L'horodatage `resetsAt` correspond rigoureusement à l'addition du `Date.now()` et des `29 827` secondes renvoyées par OpenAI (réinitialisation lundi matin UTC). Lors des requêtes suivantes, le fournisseur principal est immédiatement contourné (`skippedPrimary: true`) sans pénalité de latence réseau.

### Résultat 3 : Découverte majeure en exécution CLI Headless (`node dist/index.js -p`)
Lors du lancement complet via le CLI en mode agent headless (`node dist/index.js -p "dis coucou"`), la commande a échoué avec l'erreur apparente :
`Agent turn failed: ChatGPT Responses backend error (429)`

L'investigation approfondie par tracing direct de l'exécution a mis en évidence le mécanisme exact de cet échec :
1. En mode agent, Code Buddy injecte la panoplie complète de ses outils d'exécution (`getAllCodeBuddyTools()`), représentant plus de **60 000 tokens** de descriptions et de schémas JSON.
2. Alors que ChatGPT accepte des contextes de plus de 200 000 tokens, l'instance locale d'Ollama est configurée avec une fenêtre maximale de **32 768 tokens**.
3. Lors du déclenchement du repli dans `chatStreamWithDeclaredFailover`, `prepareFailoverMessages` compacte l'historique des messages, mais **laisse le tableau `tools` intégralement inchangé**.
4. Ollama rejette immédiatement la requête de repli avec une erreur HTTP 400 explicite :
   ```text
   Direct Ollama with tools failed: Error: CodeBuddy API error: Ollama API error: 400 Bad Request — 
   {"error":"request (60480 tokens) exceeds the available context size (32768 tokens), try increasing it"}
   ```
5. En l'absence d'autre fournisseur dans la chaîne de repli, le catch final de `chatStreamWithDeclaredFailover` propage l'erreur d'origine (`throw primaryError`), masquant ainsi le rejet 400 d'Ollama derrière le 429 initial de ChatGPT !

---

## 5. Bilan & 5 Améliorations Prioritaires

### Synthèse (10 lignes)
1. **Double nature du failover** : OmniRoute agit comme un proxy universel prédictif et multi-stratégies, tandis que Code Buddy implémente une cascade déclarative applicative intégrée au client.
2. **Détection réactive confirmée** : La capture du 429 réel de ChatGPT et l'extraction de `resets_in_seconds` (8h restantes) fonctionnent parfaitement dans Code Buddy.
3. **Persistance et court-circuit** : Le fichier `provider-health.json` garantit le contournement immédiat du fournisseur primaire sans re-tester le réseau inutilement.
4. **Goulot d'étranglement des outils** : Le handoff actuel de Code Buddy filtre les messages mais omet de réduire le volume des définitions d'outils (`tools`), causant un débordement de contexte (60k vs 32k) sur les modèles locaux.
5. **Masquage d'erreur** : Lorsqu'un fallback échoue avec une erreur 400, l'erreur 429 du primaire est renvoyée à l'agent, occultant la cause racine.
6. **Intégrité de flux respectée** : L'interdiction du basculement en cours de flux (`yieldedAnyChunk`) est une décision saine pour préserver la cohérence du code produit.
7. **Reprise de session** : La réactivation du primaire à expiration de `resets_at` est déjà en place et efficace.
8. **Dualité historique résiduelle** : Coexistence confuse entre l'ancien `CODEBUDDY_LLM_FAILOVER` et le nouveau `CODEBUDDY_PROVIDER_FALLBACK`.
9. **Observabilité perfectible** : Manque d'événements typés vers le canal compagnon Lisa pour expliciter la dégradation de service à l'utilisateur.
10. **Alignement réalisable** : Code Buddy peut atteindre la résilience d'OmniRoute en appliquant un élagage ciblé des outils et une unification de ses chaînes de repli.

### 5 Améliorations de contrat prioritaires (une ligne par recommandation)
1. **Élagage dynamique des outils au handoff** : filtrer les schémas d'outils transmis au modèle de repli ou basculer en mode RAG tool selection pour ne jamais dépasser le contexte maximal du LLM cible.
2. **Journalisation et diagnostic des erreurs de fallback** : enrichir l'exception levée après épuisement de la chaîne pour rapporter les échecs des cibles de secours au lieu de masquer l'incident derrière le 429 initial.
3. **Unification des sous-systèmes de repli** : fusionner le mécanisme historique `applyActiveLlmFailover` (`active-llm-registry.ts`) avec la nouvelle chaîne déclarative `CODEBUDDY_PROVIDER_FALLBACK`.
4. **Notification événementielle vers Lisa / Companion** : émettre un événement structuré sur le bus d'événements lors d'un basculement afin d'alerter l'utilisateur dans l'interface conversationnelle.
5. **Pré-filtrage proactif basé sur la fenêtre de contexte** : vérifier la capacité de contexte du candidat de repli avant la tentative d'envoi et sauter les modèles manifestement sous-dimensionnés.
