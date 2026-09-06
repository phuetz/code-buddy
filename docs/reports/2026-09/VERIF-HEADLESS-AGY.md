# Rapport de vérification croisée — Lot « Voie locale de buddy -p » (Grok)

- **Date** : 2026-09-06
- **Auditeur indépendant** : Antigravity (AGY)
- **Worktree** : `~/DEV/cb-headless-2026-09-06`
- **Branche** : `fix/headless-local-2026-09-06`
- **Base de comparaison** : `4901d75e4`
- **Commits Grok audités** :
  - `1eeb2e3f9` : `fix(ollama): router le transport natif hors du port 11434`
  - `9246d7dc0` : `fix(cli): traiter une reponse headless vide comme un echec`
  - `e52fb2df1` : `feat(cli): indicateur TTY evaluation du prompt en -p`
  - `1d587cf9b` : `fix(local): stall adaptatif et prompt compact pour -p`
  - `adace38b1` : `docs(headless): rapport et passation GROK-HEADLESS`
- **Rapport audité** : `docs/reports/2026-09/REPARATION-HEADLESS-LOCAL-GROK.md`
- **Environnement QA isolé** : `~/DEV/cb-headless-2026-09-06/_qa/verif/home`
- **Endpoint Ollama** : `http://127.0.0.1:11435` (modèles autorisés : `qwen3:4b-instruct`, `qwen3.8-ctx32k:latest`)

---

## 1. Tableau synthétique des vérifications

| N° | Point audité | Composants & Lignes | Statut | Preuve synthétique |
|---|---|---|---|---|
| **1a** | Prompt byte-identique cloud & interactif | `src/config/headless-local-prompt.ts:33-38`<br>`src/services/prompt-builder.ts:299,1055,1142` | **TIENT** | `isHeadlessLocalPromptCompact()` renvoie `false` dès que `CODEBUDDY_HEADLESS !== 'true'` ou que le fournisseur n'est pas local (`isLocalLlmProvider` faux pour OpenAI, Anthropic, Gemini, xAI). Le prompt système complet et la sélection d'outils restent 100% identiques à la base. |
| **1b** | Stall 120 s cloud & interactif (absence de régression) | `src/agent/execution/agent-executor.ts:1658`<br>`src/utils/stream-stall-guard.ts:51-67` | **TROU (B)** | **Régression B avérée.** Dans `agent-executor.ts:1658`, `firstTokenTimeoutMs: resolveFirstTokenStallTimeoutMs(inputTokens)` est passé inconditionnellement. Pour un prompt cloud de 3 000 tokens d'entrée, le stall de premier token passe à `3000 × 200 ms = 600 s (10 min)` au lieu de 120 s. Un cloud muet attendra jusqu'à 20 min (`CODEBUDDY_STALL_MAX_MS`) au lieu de tomber en 120 s. S'applique aussi au mode interactif. |
| **1c** | Filtrage `isOllamaEndpoint` (cloud, LM Studio, vLLM) | `src/codebuddy/providers/ollama-native-transport.ts:127-139`<br>`tests/codebuddy/providers/ollama-native-transport.test.ts:43-76` | **TIENT** | `isOllamaEndpoint` renvoie `false` pour `api.openai.com`, `generativelanguage`, `http://127.0.0.1:1234/v1` (LM Studio), et vLLM `:8000`. Testé unitairement. |
| **1d** | Sonde `GET /api/tags` confinée au loopback | `src/codebuddy/providers/ollama-native-transport.ts:177`<br>`tests/codebuddy/providers/ollama-native-transport.test.ts:136-144` | **TIENT** | `resolveOllamaEndpoint` vérifie `if (!isLoopbackLlmHost(baseURL)) return false;` avant toute tentative I/O. Aucune requête n'est émise vers les URLs publiques (`fetchImpl` mocké : 0 appel). |
| **2a** | Réponse vide en `-p` = échec (exit ≠ 0 + stderr) | `src/cli/headless-options.ts:20-41`<br>`src/index.ts:1294-1306`<br>`tests/cli/headless-empty-response.test.ts:43-124` | **TIENT** | Sortie vide ou `<think>` seul sans texte visible détecté par `isHeadlessFinalResponseEmpty`. Exit code 1 avec diagnostic stderr : `le modèle n'a rien renvoyé ; provider=... modèle=... durée=...s`. Prouvé sous spawn d'un serveur mock. |
| **2b** | Réponse vide en INTERACTIF ne tue pas la session | `src/index.ts:1294-1306` | **TIENT** | Le diagnostic fatal et `return 1` sont localisés dans `processPromptHeadless`. La boucle interactive `runInteractiveSession` reste inchangée et ne termine pas le processus sur réponse vide. |
| **2c** | Garde-fou `think:false` transport natif Ollama | `src/codebuddy/providers/ollama-native-transport.ts:273-290,304` | **TIENT** | `think:false` n'est produit que par `toOllamaNativeRequest` pour `/api/chat`. Pour un modèle non-thinking (`qwen3:4b-instruct`), `isOllamaThinkingModel` est `false` donc `think` reste `undefined`. De plus, éprouvé en direct sur Ollama 11435 avec `curl` : Ollama accepte `think:false` sur `qwen3:4b-instruct` avec HTTP 200 OK. |
| **3a** | Mesure tokens prompt compact (-p local) AVANT / APRÈS | `src/services/prompt-builder.ts:1049-1068`<br>`src/config/headless-local-prompt.ts:6-7` | **TIENT** | **AVANT** (`4901d75e4`) : budget de 15 360 tokens, prompt système de 55 415 chars non tronqué + 15+ outils = 5 604 tokens prompt (TTFT 863 s).<br>**APRÈS** : budget système 1 500 tokens (8 191 chars) + 8 outils RAG = 2 462 tokens prompt (TTFT 242 s). |
| **3b** | Explication de l'écart (2 462 tokens vs objectif ≤ 1 500) | `src/services/prompt-builder.ts:1056` | **TIENT** | Le plafond `HEADLESS_LOCAL_COMPACT_MAX_TOKENS = 1500` s'applique au seul `systemPrompt`. Les 962 tokens résiduels correspondent aux définitions JSON Schema des 8 outils RAG injectés (~850 tokens), au prompt utilisateur et au template de conversation Ollama. |
| **3c** | Outils RAG ≤ 8 incluent `view_file` et `bash` | `src/config/headless-local-prompt.ts:8-13`<br>`src/agent/execution/agent-executor.ts:1464` | **TIENT** | `HEADLESS_LOCAL_COMPACT_ALWAYS_INCLUDE` injecte systématiquement `view_file`, `bash`, `search`, `tool_search`. Confirmé en test live : `view_file` est invoqué avec succès sur requête de listing de dossier. |
| **3d** | Opt-out `CODEBUDDY_PROMPT_COMPACT=false` | `src/config/headless-local-prompt.ts:36`<br>`tests/config/headless-local-prompt.test.ts:28` | **TIENT** | Dès que `CODEBUDDY_PROMPT_COMPACT=false`, `isHeadlessLocalPromptCompact()` renvoie `false`. Vérifié en live : la taille brute du prompt remonte de 10 210 à 49 223 chars et le budget repasse à sa valeur par défaut. |
| **4** | Indicateur TTY : silence stdout / non-TTY / --quiet | `src/cli/headless-prompt-progress.ts:14-21`<br>`tests/cli/headless-prompt-progress.test.ts:14-23` | **TIENT** | `shouldShowHeadlessPromptProgress` requiert `stdout.isTTY === true`, `CODEBUDDY_HEADLESS === 'true'`, et `!CODEBUDDY_QUIET`. Sortie exclusivement sur `stderr`. Couverture unitaire avec fake timers à 100%. |
| **5a** | Suite Vitest globale | `tests/` (408 fichiers) | **TIENT** | 407 fichiers passés, 4 680 tests passés, 0 échec imputable au lot. Le seul fichier en échec (`hermes-commands.test.ts`, 3 tests) tente d'instancier un vrai binaire Playwright manquant dans l'environnement Linux ; 0 modification depuis la base `4901d75e4` (`git diff` vide, 100% vert avec `CI=1`). Les 7 suites du lot Grok sont à **64/64 passés**. |
| **5b** | Vérifications statiques (tsc, lint, git diff --check) | `tsconfig.json`, ESLint, git diff | **TIENT** | `npx tsc --noEmit -p tsconfig.json` : code 0, 0 erreur.<br>`npm run lint` : code 0, 0 erreur.<br>`git diff --check 5c7c0e078..HEAD` : code 0, 0 erreur. |
| **6a** | Live 1 : Listing dossier 3 fichiers (`qwen3:4b-instruct`) | `dist/index.js -p "liste les fichiers du dossier courant"` | **TIENT** | Exécuté dans `_qa/hl/live-test-dir` : appel d'outil `view_file({"path":"."})`, résultat `fichier_alpha.txt \n fichier_beta.txt \n fichier_gamma.txt`, exit code 0, durée **16,00 s** (vs 14 min 27 initiales). |
| **6b** | Live 2 : Réponse directe "OK" (`qwen3:4b-instruct`) | `dist/index.js -p "Réponds uniquement par le mot OK"` | **TIENT** | Sortie `{"result":"OK",...}`, exit code 0, durée **6,42 s**. |

---

## 2. Détail de la régression B identifiée (Point 1b)

### Localisation
Fichier : `src/agent/execution/agent-executor.ts` lignes 1657–1659
```typescript
), resolveStallTimeoutMs(), {
  firstTokenTimeoutMs: resolveFirstTokenStallTimeoutMs(inputTokens),
});
```

### Mécanisme du défaut
1. `resolveFirstTokenStallTimeoutMs(inputTokens)` calcule :
   `Math.min(Math.max(120_000, Math.ceil(promptTokens * msPerToken)), maxMs)` où `msPerToken` vaut 200 ms et `maxMs` vaut 20 min.
2. Dans `AgentExecutor`, cet argument `firstTokenTimeoutMs` est fourni **sans conditionner sur le fournisseur ni sur le mode d'exécution**.
3. Par conséquent, pour toute requête adressée à un fournisseur Cloud (OpenAI ChatGPT, Anthropic Claude, Google Gemini, xAI Grok) comportant par exemple 3 000 tokens de contexte (courant avec historique ou RAG) :
   `budget = 3000 * 200 ms = 600 000 ms (10 minutes)`.
4. Si le service Cloud subit un dysfonctionnement et reste muet après avoir accepté la connexion HTTP, le stall guard attendra **10 à 20 minutes** avant de lever `LlmStallError`, au lieu de lever l'erreur au bout de **120 secondes** comme le prescrit le comportement d'origine.
5. Cette extension indésirable s'applique également aux sessions interactives standard.

### Correctif requis (≤ 3 lignes)
Dans `src/agent/execution/agent-executor.ts` ligne 1658, restreindre `firstTokenTimeoutMs` au mode compact local :
```typescript
-          firstTokenTimeoutMs: resolveFirstTokenStallTimeoutMs(inputTokens),
+          firstTokenTimeoutMs: isHeadlessLocalPromptCompact()
+            ? resolveFirstTokenStallTimeoutMs(inputTokens)
+            : undefined,
```
Lorsque `firstTokenTimeoutMs` est `undefined`, `withStallGuard` retombe sur `timeoutMs` (120 s dès le départ), préservant l'intégrité stricte des flux Cloud et interactifs.

---

## 3. Traces d'exécution Live

### Test Live 1 — 3 fichiers dans le dossier courant
```text
$ CODEBUDDY_PROVIDER=ollama OLLAMA_HOST=http://127.0.0.1:11435 GROK_MODEL=qwen3:4b-instruct \
  time -p node dist/index.js -p "liste les fichiers du dossier courant"

[2026-09-06T17:28:39.631Z] ℹ️ INFO  Auto-detected provider: ollama (model: qwen3:4b-instruct)
[2026-09-06T17:28:40.766Z] ⚠️ WARN  System prompt truncated for qwen3:4b-instruct: 10210 chars → 8191 (budget: 1500 tokens, 32K hard cap); blocs retirés : persistent-memory, writing-rules
évaluation du prompt… (10 s)
[2026-09-06T17:28:51.151Z] ℹ️ INFO  [notification] view_file completed in 29ms {"priority":"low","channel":"cli"}
[2026-09-06T17:28:53.628Z] ℹ️ INFO  Token usage: [tokens: 4,223 in / 45 out | cost: $0.0000]
{"result":"fichier_alpha.txt  \nfichier_beta.txt  \nfichier_gamma.txt","cost":{"total":0,"estimated":false,"pricing":"subscription","billing":"subscription"},"model":"qwen3:4b-instruct","messages":[{"role":"user","content":"liste les fichiers du dossier courant"},{"role":"assistant","content":"","tool_calls":[{"id":"fiOU02SkZxdi09DSs39zGDxTlE5CXsMq","type":"function","function":{"name":"view_file","arguments":"{\"path\":\".\"}"}}]},{"role":"tool","tool_call_id":"fiOU02SkZxdi09DSs39zGDxTlE5CXsMq","content":"Directory contents of ~/DEV/cb-headless-2026-09-06/_qa/hl/live-test-dir:\nfichier_alpha.txt\nfichier_beta.txt\nfichier_gamma.txt"},{"role":"assistant","content":"fichier_alpha.txt  \nfichier_beta.txt  \nfichier_gamma.txt"}]}
real 16.00
user 2.50
sys 0.31
Exit code: 0
```

### Test Live 2 — Réponse directe "OK"
```text
$ CODEBUDDY_PROVIDER=ollama OLLAMA_HOST=http://127.0.0.1:11435 GROK_MODEL=qwen3:4b-instruct \
  time -p node dist/index.js -p "Réponds uniquement par le mot OK"

[2026-09-06T17:28:59.008Z] ℹ️ INFO  Auto-detected provider: ollama (model: qwen3:4b-instruct)
[2026-09-06T17:28:59.896Z] ⚠️ WARN  System prompt truncated for qwen3:4b-instruct: 10210 chars → 8191 (budget: 1500 tokens, 32K hard cap); blocs retirés : persistent-memory, writing-rules
[2026-09-06T17:29:03.659Z] ℹ️ INFO  Token usage: [tokens: 2,068 in / 1 out | cost: $0.0000]
{"result":"OK","cost":{"total":0,"estimated":false,"pricing":"subscription","billing":"subscription"},"model":"qwen3:4b-instruct","messages":[{"role":"user","content":"Réponds uniquement par le mot OK"},{"role":"assistant","content":"OK"}]}
real 6.42
user 1.83
sys 0.26
Exit code: 0
```

---

## 4. Bilan

Le lot Grok résout remarquablement le dysfonctionnement initial de la voie locale Ollama hors port 11434 : la commande `buddy -p` sur Ollama 11435 passe de 14 min 27 (sortie vide) à 16 s avec appel d'outil `view_file` fonctionnel et 6,42 s sur réponse directe (exit 0). Les vérifications de routage Ollama, sonde loopback, diagnostic fatal en cas de réponse headless vide et indicateur TTY sont pleinement validées (64/64 tests verts, tsc 0, lint 0). Néanmoins, une régression B a été caractérisée dans `src/agent/execution/agent-executor.ts:1658` : le seuil adaptatif de premier token (`resolveFirstTokenStallTimeoutMs`) y est activé sans filtrage de fournisseur ni de mode, augmentant le stall d'un modèle cloud muet jusqu'à 20 min au lieu des 120 s d'origine. Ce défaut doit être corrigé en restreignant l'option à `isHeadlessLocalPromptCompact()` avant tout push.

---

VERDICT: NON PUSHABLE (régression B: seuil adaptatif premier token appliqué aux fournisseurs cloud et en mode interactif au lieu de 120s)
