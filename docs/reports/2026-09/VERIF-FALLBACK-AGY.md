# VERIF-FALLBACK-AGY — Vérification adversariale du repli automatique de fournisseur

Date : 2026-09-06 (Europe/Paris)  
Auteur : Agent Antigravity (AGY)  
Dépôt : `~/DEV/cb-fallback-2026-09-06`  
Branche : `feat/provider-fallback-2026-09-06`  
Commits vérifiés : `e2f642a6c..1fa4a76a8` (6 commits au-dessus de `aef1bdfbd`)  
Rapport audité : `docs/reports/2026-09/PROVIDER-FALLBACK-GROK.md`  
Environnement de test isolé : `HOME=~/DEV/cb-fallback-2026-09-06/_qa/agy/home` et `env -u FORCE_COLOR`  
Règle de sécurité : aucun accès à `~/code-buddy` ni `~/.codebuddy`. Chemins en `~`, aucun prénom.

---

## 1. Synthèse de la vérification

| Point | Description | Statut | Gravité |
|---|---|---|---|
| (1) | **Byte-identique OFF** : sans `CODEBUDDY_PROVIDER_FALLBACK`, pas de fichier `provider-health.json`, pas d'appel extra, erreur d'origine intacte | **TIENT** | - |
| (2) | **Classification des erreurs** : 429 `usage_limit_reached` (quota), 429 rate-limit (overloaded 60s), 503/529 (overloaded), ECONNREFUSED (unreachable), 401/403 (auth sans repli) ; couverture Anthropic / Gemini / xAI | **TROU** | Gravité B |
| (3) | **Chaîne de repli** : `CODEBUDDY_FALLBACK_CHAIN`, saut silencieux des fournisseurs non authentifiés, respect de `LOCAL_ONLY`, chaîne vide ⇒ erreur d'origine | **TIENT** | - |
| (4) | **Transfert de contexte** : retroncature prompt, compactage contexte plus petit, note de reprise en message système, réparation transcript outils | **TIENT** | - |
| (5) | **Santé persistée** : `provider-health.json` en atomic-write 0o600, aucun secret, pas de rappel avant `resets_at`, retour tour suivant ; concurrence multi-processus | **TROU** | Gravité B |
| (6) | **Visibilité** : événement bus `provider:fallback`, intégration `buddy doctor` et `buddy whoami` | **TROU** | Gravité C |
| (7) | **Suite de régression** : exécution de la suite Vitest requise (2075 passés) + `tsc --noEmit` | **TIENT** | - |
| (8) | **Essai réel** : bascule réelle `unreachable → local` (`OLLAMA_HOST=http://127.0.0.1:9` vers Ollama local sur port 11435) | **TROU** | Gravité A |

---

## 2. Détail des vérifications (commandes, sorties, analyses code)

### (1) Byte-identique OFF — TIENT

**Code vérifié :**
- `src/codebuddy/client.ts:512-522` : `resolveDeclaredFallbackProviders` n'est invoqué que si `isDeclaredProviderFallbackEnabled()` est vrai.
- `src/codebuddy/client.ts:534-536` : `usesDeclaredFailover(opts)` retourne `false` quand `CODEBUDDY_PROVIDER_FALLBACK` est absent ou faux.
- `src/codebuddy/client.ts:720,740-744,990,1022-1026` : En cas de flag OFF, `chat` et `chatStream` empruntent exclusivement `chatWithProviderFallback` (chemin historique Hermes). Si aucun secours n'est configuré, l'erreur `primaryError` est renvoyée intacte sans aucun appel supplémentaire et sans créer `provider-health.json`.
- `tests/codebuddy/provider-failover.test.ts:155-170` : Test unitaire dédié prouvant l'absence de fichier santé et l'absence de note de reprise.

**Preuve commande (Node, HOME isolé, sans flag) :**
```bash
HOME=~/DEV/cb-fallback-2026-09-06/_qa/agy/home node -e '
import { CodeBuddyClient } from "./dist/codebuddy/client.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const healthFile = path.join(os.homedir(), ".codebuddy", "provider-health.json");
const existsBefore = fs.existsSync(healthFile);

const client = new CodeBuddyClient("dummy-key", "dummy-model", "http://127.0.0.1:9/v1", {
  enableFallbacks: false,
});

client.chat([{ role: "user", content: "hi" }]).catch((err) => {
  const existsAfter = fs.existsSync(healthFile);
  console.log("Error caught:", err.message);
  console.log("Health file existed before:", existsBefore, "after:", existsAfter);
});
'
```
**Sortie observée :**
```text
Error caught: CodeBuddy API error: Connection error.
Health file existed before: false after: false
```
Le comportement reste strictement byte-identique.

---

### (2) Classification des erreurs — TROU (Gravité B)

**Points qui TIENNENT :**
- **429 `usage_limit_reached`** : `src/codebuddy/provider-error-classifier.ts:279-286` classe `reason: 'quota_exhausted'`, `fatal: true`. Dans `src/codebuddy/provider-failover-kind.ts:123-132`, `extractResetsInSeconds` extrait la durée et calcule `resetsAt = nowMs + ttl`.
- **429 simple rate-limit** : `src/codebuddy/provider-error-classifier.ts:336-338` classe `retryable: true`, `reason: 'rate_limited'`. Dans `src/codebuddy/provider-failover-kind.ts:159-167`, il est classé `overloaded` avec un backoff court de 60 s (`OVERLOADED_TTL_MS`), et **non** comme un quota.
- **503 / 529 / `overloaded_error`** : `src/codebuddy/provider-failover-kind.ts:95-104,138-146` classe en `overloaded` avec `resetsAt = nowMs + 60_000`.
- **401 / 403** : `src/codebuddy/provider-failover-kind.ts:134-136` classe en `auth` (`shouldFailover: false`), `src/codebuddy/client.ts:882-890` appelle `notifyAuthFailure` et relance l'erreur sans bascule.

**Ce qui est un TROU (Gravité B) :**
1. **Anthropic** :
   - Épuisement du solde de crédits Anthropic : l'API Claude renvoie une erreur HTTP 400 (`invalid_request_error: Your credit balance is too low to access the Claude API. Please go to Plans & Billing to upgrade or purchase credits.`). Dans `src/codebuddy/provider-error-classifier.ts:326-333`, le statut 400 et le texte "invalid request" le classent en `invalid_request` (`fatal: true`). Dans `src/codebuddy/provider-failover-kind.ts:170-174`, `invalid_request` devient `kind: 'other'` avec `shouldFailover: false`. Le repli n'est **jamais déclenché** pour un compte Anthropic à sec.
   - Limite mensuelle Anthropic (429 "You have exceeded your monthly limit") : le message ne contient pas le terme "quota", il est donc classé en simple congestion `overloaded` (60 secondes) au lieu de `quota_exhausted` (1 heure).
2. **Gemini** :
   - Le message canonique 429 de Gemini `RESOURCE_EXHAUSTED` est `"Resource has been exhausted (e.g. check quota)."`. Dans `src/codebuddy/provider-error-classifier.ts:288-290`, `hasQuota` est vrai, mais `message.includes('exceed')` est faux (le message utilise "exhausted", non "exceed" ni "insufficient" ni "billing"). En conséquence, ce signal n'est pas classé `quota_exhausted`, mais retombe à la ligne 337 en 429 `rate_limited` (`overloaded`, banc de 60 s seulement).
3. **xAI** :
   - En cas de 403 `out_of_credits`, le statut 403 est intercepté en `auth_failed` (aucun repli).

**Preuve commande :**
```bash
node -e '
import("./dist/codebuddy/provider-failover-kind.js").then(({ classifyFailoverKind }) => {
  const anthropicCredit = new Error("Your credit balance is too low to access the Claude API. Please go to Plans & Billing to upgrade or purchase credits.");
  anthropicCredit.status = 400;
  anthropicCredit.type = "invalid_request_error";
  console.log("Anthropic 400 credit balance:", JSON.stringify(classifyFailoverKind(anthropicCredit)));

  const geminiResource = new Error("Resource has been exhausted (e.g. check quota).");
  geminiResource.status = 429;
  geminiResource.statusText = "RESOURCE_EXHAUSTED";
  console.log("Gemini Resource exhausted 429:", JSON.stringify(classifyFailoverKind(geminiResource)));
});
'
```
**Sortie observée :**
```text
Anthropic 400 credit balance: {"kind":"other","shouldFailover":false,"status":400,"reason":"invalid_request"}
Gemini Resource exhausted 429: {"kind":"overloaded","shouldFailover":true,"status":429,"resetsAt":1788682262635,"reason":"rate_limited"}
```

---

### (3) Chaîne de repli — TIENT

**Code vérifié :**
- `src/providers/provider-failover-policy.ts:45-61` : `parseFallbackChain` découpe correctement les séparateurs `>` et `,` et conserve les étiquettes de modèles (ex: `ollama:qwen3.8-ctx32k:latest`).
- `src/providers/provider-failover-policy.ts:91-118` : `resolveDeclaredFallbackProviders` résout chaque fournisseur via le catalogue avec `requireConfigured: true`. La ligne 99 `if (!provider.apiKey) continue;` saute silencieusement tout fournisseur non authentifié, sans journalisation intempestive ni requête réseau.
- `src/providers/provider-failover-policy.ts:111` : `if (localOnly && !isLocalFailoverCandidate(candidate)) continue;` filtre rigoureusement tout fournisseur cloud lorsque `CODEBUDDY_LOCAL_ONLY` est actif.
- `src/codebuddy/client.ts:903` : si `candidates.length === 0` (chaîne vide ou tous candidats exclus), l'erreur d'origine `primaryError` est levée intacte.

**Preuve commande :**
```bash
node -e '
import("./dist/providers/provider-failover-policy.js").then(({ resolveDeclaredFallbackProviders }) => {
  const env = { CODEBUDDY_FALLBACK_CHAIN: "chatgpt-oauth>xai>gemini>ollama:qwen3.8-ctx32k:latest" };
  const res = resolveDeclaredFallbackProviders({ env, hasChatGptOAuth: false });
  console.log("Sans clés cloud:", res.map(r => r.provider));

  const envXai = { ...env, XAI_API_KEY: "dummy" };
  console.log("Avec XAI_API_KEY:", resolveDeclaredFallbackProviders({ env: envXai, hasChatGptOAuth: false }).map(r => r.provider));
  console.log("Avec LOCAL_ONLY:", resolveDeclaredFallbackProviders({ env: { ...envXai, CODEBUDDY_LOCAL_ONLY: "true" }, hasChatGptOAuth: false }).map(r => r.provider));
  console.log("Chaîne vide:", resolveDeclaredFallbackProviders({ env: { CODEBUDDY_FALLBACK_CHAIN: "" }, hasChatGptOAuth: false }).length);
});
'
```
**Sortie observée :**
```text
Sans clés cloud: [ 'ollama' ]
Avec XAI_API_KEY: [ 'grok', 'ollama' ]
Avec LOCAL_ONLY: [ 'ollama' ]
Chaîne vide: 0
```

---

### (4) Transfert de contexte — TIENT

**Code vérifié :**
- `src/codebuddy/provider-handoff.ts:63-67` : `buildResumeNote` génère la balise `<provider_resume>conversation reprise par ... après indisponibilité de ...</provider_resume>`.
- `src/codebuddy/provider-handoff.ts:145-148` : La note est insérée avec `role: 'system'` juste avant le premier message non-système. Elle n'est **jamais injectée** dans le texte de l'utilisateur.
- `src/codebuddy/provider-handoff.ts:69-85` : `retruncateSystemPrompt` applique `truncatePromptBlocksByPriority` pour ramener le système prompt au budget du modèle de repli.
- `src/codebuddy/provider-handoff.ts:101-136` : `compactMessagesForModelAsync` compacte l'historique via `ContextManagerV2` ou compactage glissant si la fenêtre du secours est plus étroite.
- `src/codebuddy/provider-handoff.ts:142` : `repairToolCallPairs(messages)` est appelé en premier pour réparer tout appel d'outil orphelin au moment de la panne.
- `tests/codebuddy/provider-handoff.test.ts:10-33,35-50` : Tests unitaires verts.

---

### (5) Santé persistée — TROU (Gravité B)

**Points qui TIENNENT :**
- **Atomic-write & Permissions** : `src/providers/provider-health.ts:88` utilise `writeJsonAtomicSync`, qui écrit dans un fichier temporaire puis le renomme de manière atomique sous le mode `0o600` (`-rw-------`).
- **Absence de secrets** : Aucun jeton, clé d'API ni en-tête d'authentification n'est persisté.
- **Mise de côté respectée (spy)** : Le fournisseur banni n'est pas réinterrogé avant `resetsAt` (test `tests/codebuddy/provider-failover.test.ts:172-212`).
- **Retour tour suivant** : `maybeReturnToOriginal` n'est invoqué qu'au début du tour suivant (`chat` ligne 730, `chatStream` ligne 1001), jamais en plein milieu d'un tour.

**Contenu vérifié du fichier `provider-health.json` :**
```json
{
  "version": 1,
  "providers": {
    "chatgpt-oauth": {
      "kind": "quota_exhausted",
      "message": "ChatGPT Responses backend error (429): {\"error\":{\"type\":\"usage_limit_reached\",\"resets_in_seconds\":73172}}",
      "failedAt": 1788682258924,
      "resetsAt": 1788755430924,
      "lastModel": "gpt-5.6-sol"
    }
  },
  "lastFailover": {
    "from": "chatgpt-oauth",
    "to": "ollama",
    "toModel": "qwen3.8-ctx32k:latest",
    "kind": "quota_exhausted",
    "at": 1788682258935
  }
}
```

**Ce qui est un TROU (Gravité B) : Concurrence multi-processus cassée**
- Dans `src/providers/provider-health.ts:86`, `persist(snapshot)` définit `memoryOverride = snapshot`.
- Dans `src/providers/provider-health.ts:74`, `readProviderHealthSnapshot()` fait :
  ```ts
  if (memoryOverride) return memoryOverride;
  ```
- **Conséquence directe :** Dès qu'un processus a écrit une fois dans `provider-health.json`, `memoryOverride` est défini en mémoire. Ce processus **ne relit plus jamais le fichier sur disque**.
- Si un processus A (ex: `buddy server`) note une panne sur `chatgpt-oauth`, puis qu'un processus B (ex: `buddy channels`) note une panne sur `gemini`, le processus A ne voit jamais la panne de `gemini`. Pire : dès que le processus A réécrit (par exemple lors du rétablissement de `chatgpt-oauth`), il réécrit sa propre mémoire locale et **écrase purement et simplement** les entrées écrites sur disque par le processus B (mise à jour perdue / lost update).

**Preuve commande (concurrence multi-processus) :**
```bash
HOME=~/DEV/cb-fallback-2026-09-06/_qa/agy/home node -e '
import { recordProviderFailure, recordProviderSuccess, isProviderUnavailable, readProviderHealthSnapshot, getProviderHealthPath } from "./dist/providers/provider-health.js";
import { execSync } from "node:child_process";
import fs from "node:fs";

recordProviderFailure("chatgpt-oauth", "quota_exhausted", { resetsInSeconds: 3600 });
console.log("P1 écrit chatgpt-oauth. Snapshot P1:", Object.keys(readProviderHealthSnapshot().providers));

// Processus P2 concurrent écrit gemini
execSync("HOME=" + process.env.HOME + " node -e \"const { recordProviderFailure } = require(\\\"./dist/providers/provider-health.js\\\"); recordProviderFailure(\\\"gemini\\\", \\\"overloaded\\\");\"", { stdio: "inherit" });

console.log("P1 voit gemini indisponible ?", isProviderUnavailable("gemini"));
recordProviderSuccess("chatgpt-oauth");
console.log("Contenu final sur disque:", fs.readFileSync(getProviderHealthPath(), "utf8"));
'
```
**Sortie observée :**
```text
P1 écrit chatgpt-oauth. Snapshot P1: [ 'chatgpt-oauth' ]
P1 voit gemini indisponible ? false
Contenu final sur disque: {
  "version": 1,
  "providers": {},
...
```
L'indisponibilité de `gemini` enregistrée par P2 a été totalement effacée du disque par P1.

---

### (6) Visibilité — TROU (Gravité C)

**Points qui TIENNENT :**
- `buddy whoami` et `buddy doctor` affichent fidèlement la santé des fournisseurs et le dernier basculement.

**Preuve commande `whoami` :**
```bash
HOME=~/DEV/cb-fallback-2026-09-06/_qa/agy/home env -u FORCE_COLOR node dist/index.js whoami
```
**Sortie observée :**
```text
ChatGPT: not connected (run `buddy login` to authenticate)
Provider health:
  chatgpt-oauth: quota_exhausted (reset dans 20 h)
  last failover: chatgpt-oauth → ollama:qwen3.8-ctx32k:latest (quota_exhausted)
```

**Preuve commande `doctor` :**
```bash
CODEBUDDY_PROVIDER_FALLBACK=true HOME=~/DEV/cb-fallback-2026-09-06/_qa/agy/home env -u FORCE_COLOR node dist/index.js doctor
```
**Sortie observée :**
```text
  ⚠️ Provider failover:   chatgpt-oauth: quota_exhausted (reset dans 20 h);   last failover: chatgpt-oauth → ollama:qwen3.8-ctx32k:latest (quota_exhausted)
```

**Ce qui est un TROU (Gravité C) : Événement bus `provider:fallback`**
Dans `src/providers/provider-failover-notify.ts:44-48` :
```ts
getGlobalEventBus().emit('provider:fallback', {
  fromProvider: notice.fromProvider,
  toProvider: notice.toProvider,
  reason: notice.kind,
});
```
L'événement bus émis :
1. Utilise les propriétés `fromProvider` et `toProvider` au lieu de `from` et `to` (conforme à l'interface `ProviderFallbackEvent` dans `src/events/types.ts:512-517`).
2. **N'inclut pas `resets_at`** (ni `resetsAt`). `resetsAt` n'est transmis qu'à l'événement `RunStore.appendEvent('decision', ...)` (ligne 59), mais est absent du bus d'événements.

---

### (7) Suite exigée par Grok + `tsc` — TIENT

**Commandes exécutées :**
```bash
./node_modules/.bin/tsc --noEmit -p tsconfig.json
# Code de sortie : 0

HOME=~/DEV/cb-fallback-2026-09-06/_qa/agy/home env -u FORCE_COLOR ./node_modules/.bin/vitest run \
  tests/codebuddy tests/providers tests/channels tests/security/donnees-personnelles.test.ts \
  --exclude tests/channels/telegram-inconnu-journey.test.ts
```
**Sortie observée :**
```text
 Test Files  102 passed (102)
      Tests  2075 passed | 1 skipped (2076)
   Start at  10:11:10
   Duration  14.17s
```
Succès total sur la suite de régression et la vérification de types.

---

### (8) Essai réel : Bascule `unreachable → local` — TROU (Gravité A)

**Commande demandée :**
```bash
HOME=~/DEV/cb-fallback-2026-09-06/_qa/agy/home \
CODEBUDDY_PROVIDER_FALLBACK=true \
CODEBUDDY_PROVIDER=ollama \
OLLAMA_HOST=http://127.0.0.1:9 \
CODEBUDDY_FALLBACK_CHAIN="ollama>ollama:qwen3.8-ctx32k:latest@http://127.0.0.1:11435" \
node dist/index.js -p "Réponds: OK" --max-tool-rounds 0
```
**Sortie observée :**
```text
[2026-09-06T08:12:39.003Z] ℹ️ INFO  Auto-detected provider: ollama (model: qwen2.5-coder:7b)
[2026-09-06T08:12:39.050Z] ⚠️ WARN  Project settings validation: root: Unrecognized key(s) in object: 'telemetry'
[2026-09-06T08:12:39.064Z] ❌ ERROR Ollama not reachable at http://127.0.0.1:9/v1.
Start it, then install a model:
  ollama serve            # if it is not already running
  ollama pull qwen2.5-coder:7b
# Exit code 1
```

**Analyse approfondie de l'échec : 3 blocages distincts**

1. **Blocage CLI pré-flight (`src/index.ts:640-659`)** :  
   Lorsque `CODEBUDDY_PROVIDER=ollama`, le point d'entrée CLI appelle `resolveInstalledOllamaModel` sur `OLLAMA_HOST`. Si l'hôte ne répond pas (port 9), le CLI effectue immédiatement `process.exit(1)`. Ni l'agent, ni le client, ni la logique de secours ne sont instanciés.
2. **Non-reconnaissance de l'erreur réseau `Connection error.` (`src/codebuddy/provider-error-classifier.ts` et `src/codebuddy/provider-failover-kind.ts`)** :  
   Même en forçant `GROK_MODEL="qwen3.8-ctx32k:latest"` pour franchir le bootstrap, lorsque `OpenAICompatProvider` tente de se connecter au port 9, le SDK OpenAI émet `APIConnectionError: Connection error.`. `provider-openai-compat.ts:1268` ré-emballe l'erreur sous `CodeBuddy API error: Connection error.` sans conserver `err.code`.  
   Dans `isNetworkish` (`provider-failover-kind.ts:71-93`) et `isNetworkError` (`provider-error-classifier.ts:214-243`), la chaîne `"connection error"` **n'est pas recherchée** (seuls `econnrefused`, `connect timeout`, etc. sont vérifiés). L'erreur est classée `unclassified` (`kind: 'other'`, `shouldFailover: false`). Le client ne bascule pas et plante :
   ```text
   ❌ ERROR Agent turn failed {"errorType":"Error","error":"CodeBuddy API error: Connection error."}
   {"result":"Sorry, I encountered an error: CodeBuddy API error: Connection error."}
   ```
3. **Syntaxe `@http://...` non prise en charge dans la chaîne** :  
   `parseFallbackChain` (`provider-failover-policy.ts:45-61`) et `resolveDeclaredFallbackProviders` ne gèrent pas le symbole `@` pour spécifier une URL distincte par fournisseur. Le nom du modèle devient littéralement `qwen3.8-ctx32k:latest@http://127.0.0.1:11435` et l'URL reste figée sur celle dictée par l'environnement (`OLLAMA_HOST=http://127.0.0.1:9`).

**Essai réel complémentaire : Bascule ChatGPT 429 (`usage_limit_reached`) → Ollama local (11435)**  
En revanche, lorsque l'erreur initiale est une 429 `usage_limit_reached` (le cas incident ChatGPT) avec un Ollama configuré sur `http://127.0.0.1:11435`, la bascule s'opère avec succès :
```bash
HOME=~/DEV/cb-fallback-2026-09-06/_qa/agy/home node -e '
import { CodeBuddyClient } from "./dist/codebuddy/client.js";

process.env.CODEBUDDY_PROVIDER_FALLBACK = "true";
process.env.OLLAMA_HOST = "http://127.0.0.1:11435";
process.env.CODEBUDDY_FALLBACK_CHAIN = "chatgpt-oauth>ollama:qwen3.8-ctx32k:latest";

const quotaError = new Error("ChatGPT Responses backend error (429): {\"error\":{\"type\":\"usage_limit_reached\",\"resets_in_seconds\":73172}}");
quotaError.status = 429;
quotaError.type = "usage_limit_reached";
quotaError.resets_in_seconds = 73172;

const client = new CodeBuddyClient("dummy", "gpt-5.6-sol", "https://api.openai.com/v1");
client.dispatchChat = async () => { throw quotaError; };

client.chat([{ role: "user", content: "Réponds: OK" }]).then(res => {
  console.log("Réponse:", res.choices[0]?.message.content);
  console.log("Modèle effectif:", client.getLastEffectiveModel());
});
'
```
**Ligne `[fallback]` et sortie observées :**
```text
[2026-09-06T08:15:13.843Z] ⚠️ WARN  [fallback] openai → ollama:qwen3.8-ctx32k:latest (quota_exhausted, reset dans 20 h) {"source":"CodeBuddyClient","fromProvider":"openai","toProvider":"ollama","toModel":"qwen3.8-ctx32k:latest","kind":"quota_exhausted","resetsAt":1788755634155}
Réponse: OK
Modèle effectif: qwen3.8-ctx32k:latest
```

---

## 3. Inventaire des trous et recommandations

1. **Trou 1 (Gravité A) — Classification de l'erreur réseau standard OpenAI et préflight Ollama** :  
   - Ajouter `"connection error"` dans `isNetworkish` (`provider-failover-kind.ts:91`) et `isNetworkError` (`provider-error-classifier.ts:241`).
   - Dans le bootstrap CLI (`src/index.ts:640-659`), ne pas tuer le processus avec `process.exit(1)` si le repli de fournisseur est activé (`CODEBUDDY_PROVIDER_FALLBACK=true`), afin de laisser `chat`/`chatStream` tenter les fournisseurs de secours.
2. **Trou 2 (Gravité B) — Concurrence multi-processus et cache `memoryOverride`** :  
   - Supprimer l'affectation `memoryOverride = snapshot` dans `persist()` (`src/providers/provider-health.ts:86`) pour que chaque lecture recharge l'état réel du disque, ou utiliser un verrou inter-processus et réintégrer les modifications concurrentes.
3. **Trou 3 (Gravité B) — Couverture des quotas Anthropic & Gemini** :  
   - Anthropic : intercepter le statut 400 avec `message.includes("credit balance is too low")` comme un `quota_exhausted`.
   - Gemini : reconnaître `RESOURCE_EXHAUSTED` et `Resource has been exhausted` comme `quota_exhausted`.
4. **Trou 4 (Gravité B/C) — Syntaxe d'URL par hôte dans la chaîne de repli** :  
   - Permettre la syntaxe `fournisseur:modele@url` dans `parseFallbackChain` et l'injecter dans `resolveDeclaredFallbackProviders` pour surcharger `baseURL`.
5. **Trou 5 (Gravité C) — Champ `resets_at` manquant sur le bus d'événement** :  
   - Émettre `resets_at` / `resetsAt` dans l'événement bus `provider:fallback`.

---

VERDICT: 5 trous
