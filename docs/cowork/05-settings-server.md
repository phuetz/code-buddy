# Réglages & serveur embarqué

Cette page décrit deux sous-systèmes des réglages de Cowork :

1. **Providers / modèles** — le choix du LLM, des clés et des endpoints (panneau `LLMConfigPanel.tsx`, persistance dans `config-store.ts`).
2. **Serveur HTTP embarqué** — le serveur Code Buddy que démarre le bouton d'alimentation de la barre de titre (panneau `SettingsServer.tsx`, pont `ServerBridge`).

Les deux partagent la même couche de persistance : un `electron-store` chiffré géré par `config-store.ts`.

---

## 1. Providers & modèles

### Vue d'ensemble

Le panneau de configuration LLM (`src/renderer/components/LLMConfigPanel.tsx`) expose **15 providers** répartis en trois groupes :

| Groupe | Providers |
|--------|-----------|
| **Cloud** (primaire) | `chatgpt`, `openrouter`, `openai`, `anthropic`, `gemini`, `grok`, `groq`, `together`, `fireworks`, `mistral` |
| **Local** | `ollama`, `lmstudio`, `vllm` |
| **Avancé** | `custom` (protocole sélectionnable : Anthropic / OpenAI / Gemini) |

Chaque provider porte un preset par défaut (nom, `baseUrl`, modèle, indice de saisie de clé) ; pour `custom`, le protocole bascule l'URL de base et l'aide attendues.

### Authentification

Deux modes coexistent selon le provider :

- **Clé API** — saisie en clair dans un champ `password`. Les providers cloud requièrent une clé (badge `Needs key` tant qu'elle est vide) ; pour Ollama / LM Studio / vLLM la clé est **optionnelle** (champ relégué dans « Réglages avancés »).
- **OAuth** — pas de clé à saisir :
  - **ChatGPT** : bouton *Sign in* qui déclenche le flux `buddy login` côté CLI. Le statut (`signedIn`, e-mail, `plan_type`, `is_fedramp`) est rafraîchi via l'API d'auth. Le sentinel `apiKey = 'oauth-chatgpt'` route vers le backend Codex/Responses ; l'auth réelle vit dans `~/.codebuddy/codex-auth.json`, pas dans le store Cowork.
  - **Gemini** : bouton *Google sign in* (login / clear), si le pont d'auth Gemini est disponible.

### Base URL & modèle

- **Base URL optionnelle** : affichée pour `custom`, Ollama et LM Studio. Pour les providers locaux, un bouton *Discover* sonde l'instance locale (`http://localhost:11434/v1` pour Ollama, `http://localhost:1234/v1` pour LM Studio).
- **Modèle** : liste déroulante des modèles connus du provider, ou saisie manuelle (`useCustomModel`). Pour les providers OpenAI-compat locaux, un bouton *Refresh models* interroge l'endpoint `/models` en direct.
- **Contexte & max tokens par modèle** : champs `contextWindow` / `maxTokens` (`ProviderProfile` dans `config-store.ts`). Honnêtement : ces champs ne sont éditables dans l'UI que pour `ollama`, `lmstudio` et `custom` ; pour les providers cloud, les limites proviennent du registre de modèles du cœur, pas de l'UI.

### Hot-swap en session

Le changement de provider/modèle est appliqué **en cours de session**, sans redémarrage de l'app : `controller.changeProvider()` et la sauvegarde (`handleSave`) mettent à jour le profil actif, propagé à l'adaptateur moteur. Le niveau de raisonnement (`thinkingLevel`, `off..xhigh`) est lui aussi hot-swappable mid-session via le sélecteur dédié.

> **Solide.** Le panneau providers/modèles, l'OAuth ChatGPT, la découverte locale Ollama/LM Studio et le hot-swap sont des chemins éprouvés et testés.

---

## 2. Serveur HTTP embarqué

Le serveur est le **vrai serveur Code Buddy** (`src/server/index.ts` du cœur), lancé **en-process** (pas de fork enfant) par `ServerBridge` (`cowork/src/main/server/server-bridge.ts`). Tous les handlers IPC, hooks et tools partagent donc les mêmes registres.

### Réglages exposés (`SettingsServer.tsx`)

| Champ | Défaut | Note |
|-------|--------|------|
| **Port** | `3000` | Un seul port : le WebSocket `/ws` est servi sur ce port-là. |
| **Host** | `127.0.0.1` | `127.0.0.1` = local seul ; `0.0.0.0` expose sur le LAN. `127.0.0.1` / `::1` sont remappés en `localhost` au boot (évite le mismatch IPv4/IPv6 sous Windows). |
| **WebSocket** | activé | Toggle `/ws` (gateway). Nécessaire pour les *peers* de la flotte Code Buddy. |
| **JWT secret** | (vide) | Secret hex persisté. Vide ⇒ secret aléatoire généré au boot (**tokens perdus au redémarrage**). |

### Cycle de vie (start / stop / restart)

- **Start / Stop** sont câblés sur `ServerBridge.start()` / `.stop()` via IPC (`window.electronAPI.server`). `ServerBridge` est un singleton ; un `start` concurrent réutilise le boot en cours (`bootInFlight`).
- **Apply & restart** (bouton du panneau) : sauvegarde la config **puis** enchaîne `stop()` → `start({})` pour que le serveur reprenne les nouveaux réglages persistés. Un simple *Save* persiste sans redémarrer — le serveur en cours ne change pas tant qu'on ne relance pas.
- Le statut live (`running`, `host:port`, `+WS`, uptime, dernière erreur) est rafraîchi toutes les 5 s dans le panneau.

Au démarrage, `ServerBridge` initialise d'abord la base SQLite du cœur (`~/.codebuddy/codebuddy.db`, idempotent) ; un échec DB n'empêche pas le boot du serveur (la check `health.database` passera juste à `error`).

### Secret JWT

Le middleware d'auth du cœur **lève à l'import** sous `NODE_ENV=production` si `JWT_SECRET` est absent. `ServerBridge` traite ce cas, dans l'ordre :

1. Si `process.env.JWT_SECRET` est déjà défini → utilisé tel quel.
2. Sinon, si l'utilisateur a persisté un `jwtSecret` (Réglages → serveur) → injecté dans l'env.
3. Sinon, lecture de `~/.codebuddy/.jwt_secret` s'il existe.
4. Sinon, génération d'un secret de 64 octets, écrit à `~/.codebuddy/.jwt_secret` avec les permissions **`0600`**.
5. En dernier recours (écriture impossible), un secret **éphémère** en mémoire — perdu au redémarrage (les tokens émis deviennent invalides).

Le bouton *Generate* du panneau produit un secret hex de 64 octets côté renderer (`crypto.getRandomValues`), de la même forme que le fallback.

### Endpoints

> ⚠️ **Précision honnête.** Les endpoints réellement montés par le cœur (`src/server/index.ts`) diffèrent légèrement des noms raccourcis souvent cités. Voici la table exacte :

| Fonction | Route réelle |
|----------|--------------|
| Santé | `GET /api/health` (+ alias K8s) |
| Chat (SSE) | `POST /api/chat/` |
| Chat OpenAI-compat | `POST /api/chat/completions` |
| Liste modèles (chat) | `GET /api/chat/models` |
| Alias OpenAI-compat | `POST /v1/chat/completions`, `GET /v1/chat/models` |
| Liste modèles (OpenAI v1) | `GET /v1/models` |

Autrement dit : le chat SSE est sous `/api/chat`, la complétion OpenAI-compat sous `/api/chat/completions` (et son alias `/v1/chat/completions`), et la liste de modèles façon OpenAI sous `/v1/models`. **Il n'existe pas de route littérale `/v1/completions` ni `/api/models`** — ce sont des raccourcis pour les routes ci-dessus.

### Dashboard d'activité

`ServerBridge.dashboard()` expose en lecture seule le journal des 50 dernières requêtes et des stats agrégées (total, erreurs, latence moyenne, uptime, répartition par status), alimentant la modale « Server activity » de la barre de titre.

> **Solide** : start/stop/restart, persistance du port/host/WS, gestion du secret JWT (fichier `0600` + fallback). **À garder en tête** : le serveur tourne en-process — le couper coupe aussi les registres partagés ; et exposer en `0.0.0.0` ouvre l'API sur le réseau local (prévoir un secret JWT persistant et fixe).

---

## 3. Persistance (`config-store.ts`)

- Backend : **`electron-store`**, nom de store `config`, dossier projet `open-cowork`.
- **Chiffrement** : le store est créé via `createEncryptedStoreWithKeyRotation` (clé stable `open-cowork-config-stable-v1` + rotation depuis d'anciennes clés). Le chiffrement repose sur les capacités de la plateforme : **fort sous macOS / Windows** (keychain / DPAPI), **en clair sous Linux** (pas de coffre OS garanti) — à considérer comme tel pour les clés API stockées sous Linux.
- **Profils de credentials multiples** : `configSets` (jusqu'à 20) regroupent chacun un provider, un protocole, une `activeProfileKey` et une map de `profiles` par provider (`ProviderProfile` = `apiKey` / `baseUrl` / `model` / `contextWindow` / `maxTokens`). On bascule de jeu de credentials sans ressaisir les clés.
- Le bloc `server` (port / host / `websocketEnabled` / `jwtSecret`) est persisté dans le même store et relu par `ServerBridge.start()`.

```ts
// Forme persistée (extrait de AppConfig, config-store.ts)
server?: {
  port?: number;          // défaut 3000
  host?: string;          // défaut 127.0.0.1
  websocketEnabled?: boolean;
  jwtSecret?: string;     // absent ⇒ fallback runtime minté au boot
};
```

---

## Fichiers source

| Rôle | Fichier |
|------|---------|
| Panneau providers / modèles (UI) | `cowork/src/renderer/components/LLMConfigPanel.tsx` |
| Panneau serveur embarqué (UI) | `cowork/src/renderer/components/settings/SettingsServer.tsx` |
| Persistance & profils credentials | `cowork/src/main/config/config-store.ts` |
| Pont boot/stop du serveur cœur | `cowork/src/main/server/server-bridge.ts` |
| Serveur HTTP du cœur (endpoints) | `src/server/index.ts`, `src/server/routes/chat.ts` |
