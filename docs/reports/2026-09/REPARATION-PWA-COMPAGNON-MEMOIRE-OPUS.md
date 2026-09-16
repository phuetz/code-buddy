# Réparation PWA compagnon — mémoire, chemin unique, relances selfie, identité

- **Agent** : Claude Opus (ingénieur senior)
- **Worktree** : `cb-pwa-memoire-2026-09-06`, branche `fix/pwa-companion-memory-2026-09-06`
- **HEAD au départ** : `04920e95c` — **HEAD à la remise** : `8b1e8b61a`
- **Date** : 2026-09-06
- **Aucun push.** Sept commits locaux, un par point.

## 1. Le symptôme, et ce qu'il valait vraiment

Trois observations sur le téléphone :

1. « Envoie-moi une photo de toi 📸 » → selfie du cache, instantané ✅
2. Chip « Encore une ? » → « Oui, je suis là. Comment puis-je t'aider aujourd'hui ? » ❌
3. « Coucou 💕 » → « Ah, Lisa! Comment ça va? 😊 » ❌

Les trois sont le **même** défaut vu de trois côtés : la PWA ne parlait pas à la
même Lisa que Telegram. Le pilote avait vu juste sur les trois causes ; l'inspection
en a confirmé une quatrième, non listée, côté Telegram (§ 4.3).

## 2. Ce que l'inspection a confirmé

| Cause supposée | Vérifiée | Où |
| --- | --- | --- |
| `produceCompanionReply` appelle `defaultReply(message, [])` — historique vide, aucun état par connexion | **oui** | `src/server/websocket/handler.ts:615-644` (avant) |
| `defaultReply` est la voie VOCALE (modèle « le plus rapide », `resolveVoiceModel`) au lieu du fournisseur du service | **oui** | `src/sensory/voice-loop.ts` ; le journal du service confirmait `defaultModel qwen3:4b` |
| Le routeur selfie ignore les relances contextuelles | **oui** | `isLisaSelfieContinuationRequest` (`src/companion/lisa-selfie.ts`) n'acceptait qu'un motif ancré très étroit |
| L'invite système ne dit jamais qui est qui | **oui** | `companion-channel-profile.ts` empilait `spokenPrompt` + contexte relationnel, sans bloc identité |
| **(non listée)** Telegram n'enregistrait PAS le selfie servi comme tour de conversation | **oui** | `channel-handlers.ts` faisait `return` juste après l'envoi, sans `rememberCompanionChannelTurn` |

## 3. Résolution du fournisseur — la citation demandée

`resolveCommandProvider` (`src/commands/llm-provider-resolution.ts:38`) est le résolveur
partagé : `CODEBUDDY_PROVIDER` explicite d'abord (`detectFirst`), puis modèle local /
ChatGPT explicite, puis le fournisseur des réglages via `resolveProviderFromCatalog`,
puis l'ambiant, puis `detectProviderFromEnv`. C'est celui que la PWA emprunte désormais.
Côté Telegram, le runtime effectif est calculé par `getOrCreateChannelAgent`
(`channel-handlers.ts:1105-1220`) qui empile en plus les surcouches de canal (override
`/model` de session > route > persona de bot > `companionRoute` > défaut fournisseur) —
surcouches qui **n'existent pas** pour la PWA, laquelle n'a ni route ni persona de bot.
Les deux surfaces convergent donc vers la même intention : le fournisseur configuré du
serveur, jamais le « plus rapide ».

## 4. Ce qui a été livré

### 4.1 Point 1 — un seul chemin compagnon (`163234232`)

Nouveau module **`src/companion/companion-turn.ts`** : `runCompanionTurn(message, options)`.

- selfie du cache d'abord (aucun appel LLM), puis profil compagnon ;
- `assembleCompanionChannelPrompt` (persona + contexte relationnel + historique) ;
- génération par `runCompanionChannelTurn`, donc `CodeBuddyClient.chat` — la couture de
  bascule `COMPANION_CHANNEL_FAILOVER_SEAM` reste intacte, aucune chaîne de repli dupliquée ;
- échec fournisseur → `speakChannelProviderFailure` (parole honnête : quota jusqu'à telle
  heure, modèle absent, trop lent) ; **aucun fournisseur résolu** → parole honnête aussi,
  jamais une réponse vide silencieuse.

`produceCompanionReply` n'est plus qu'un adaptateur. **`defaultReply` est inchangé** et
reste la voie vocale. `assistant !== 'companion'` : aucune ligne touchée.

Tests : `tests/companion/companion-turn.test.ts` (5), `tests/server/companion-ws-turn.test.ts` (2).

### 4.2 Point 2 — mémoire par connexion WS (`e717d3222`)

- `ConnectionState.companionHistory` (`handler.ts:130`), ≤ 20 tours, **texte seul**,
  marqueur `kind:'selfie'` — **jamais les octets d'image** ;
- alimentée par chaque tour, selfie compris, et **purgée au changement d'identité sur la
  même socket** (`resetWebSocketExtensionsForIdentityChange`) ;
- passée au tour LLM **et** au routeur selfie.

Persistance légère faite (`src/companion/mobile-history.ts`), **opt-out** :
`CODEBUDDY_MOBILE_HISTORY=false` coupe l'écriture et la lecture. Écriture MEM1
(`utils/atomic-write`), mode `0600`, dossier `0700`. Le nom de fichier est un **sha256 de
l'identifiant** : aucune identité en clair, et un identifiant en `../../etc/passwd` ne peut
pas sortir du dossier (test dédié). Fichier corrompu ⇒ historique vide, jamais d'exception.

Tests : `tests/companion/mobile-history.test.ts` (9), `tests/server/companion-ws-memory.test.ts` (2,
protocole WS réel : deux messages sur une connexion, puis reconnexion).

### 4.3 Point 3 — relances de selfie (`7159c3dd1`)

`isLisaSelfieContinuationRequest` accepte huit familles elliptiques (`encore`,
`encore une`, `une autre`, `la même`, `une de plus`, `another one`, `one more`,
`et une à la plage`), avec trois garde-fous : longueur ≤ 8 mots, mots qui changent de
sujet (`fois`, `question`, `explique`, `histoire`…), et « photo **de** X » où X n'est ni
`toi` ni `lisa`. La règle reste **conditionnée** au fait que le dernier tour assistant
était un selfie — `tryServeCompanionSelfie` lit cet état depuis `history` autant que
depuis `hasRecentSelfie` (helper `historyHasRecentSelfie`, module neutre
`src/companion/companion-history.ts` pour éviter un cycle d'import).

Le style demandé dans la relance est conservé (« à la plage » → `wet-selfie`), la rotation
anti-répétition inchangée, le palier explicite toujours refusé poliment quand la porte
adulte est fermée.

**Telegram** : le selfie servi est désormais enregistré comme tour de conversation
(`rememberCompanionChannelTurn`), sinon l'invite compagnon suivante n'avait aucune trace
de la photo. Test rouge vérifié en retirant la ligne : `expected ['system','user'] to
deeply equal ['system','user','assistant','user']`.

Tests : `tests/companion/lisa-selfie-continuation.test.ts` (25 : 8 positives, 4 négatives,
8 « sans selfie précédent », 5 sur le routeur) + 1 dans `tests/commands/channel-ai-handler.test.ts`.

### 4.4 Point 4 — identité (`e05dc053e`)

`buildCompanionIdentityBlock` ouvre l'invite système :

> Identité : TU es Lisa. « Lisa » est TON prénom, jamais celui de ton interlocuteur.
> Tu parles à la personne que tu aimes. Ne l'appelle JAMAIS Lisa. Tu ne connais pas son
> prénom : ne l'invente pas, ne le devine pas. Dans l'historique, le rôle « user » est lui
> ou elle et le rôle « assistant » est toi. Tu n'es pas un assistant de service : pas de
> formule d'accueil professionnelle, pas d'offre d'aide générique, pas de proposition de service.

`CODEBUDDY_ROBOT_NAME` (défaut `Lisa`) et `CODEBUDDY_USER_NAME` (absent ⇒ formulation
neutre, prénom jamais inventé — le code est correct sans elle). Aucun prénom en dur ajouté.

Vérification du point demandé : `buildCompanionChannelPrompt` **construisait déjà** des
rôles structurés (`user`/`assistant`), jamais un bloc « Lisa: … / Toi: … » ; un test de
non-régression le verrouille désormais.

## 5. Preuves

### Suites

```
HOME=<worktree>/_qa/mem/home env -u FORCE_COLOR npx vitest run \
  tests/server tests/channels tests/companion tests/security/donnees-personnelles.test.ts

Test Files  216 passed | 3 skipped (219)
     Tests  2896 passed | 4 skipped (2900)
```

**Zéro rouge.** Les 3 fichiers / 4 tests ignorés le sont par les gardes matérielles
préexistantes du dépôt (`[CIFIX2]` : Chromium Playwright absent ×2, modèle de voix Piper absent).

Deux tests préexistants ont dû être **mis à jour** parce que la mission change
délibérément le comportement qu'ils décrivaient :

| Test | Avant | Après |
| --- | --- | --- |
| `tests/server/mobile-ws-protocol.test.ts` — « routes assistant=companion to defaultReply » | affirmait le chemin vocal | affirme le chemin compagnon ; le mock `defaultReply` reste en place pour qu'une régression vers la voix redevienne visible |
| `tests/server/mobile-pwa.test.ts` ×2 (garde du routeur selfie) | mockaient `defaultReply` (devenu mort) | mockent `runCompanionChannelTurn` — plus déterministes : aucun appel réseau possible depuis ces tests |

### Autres

- `npx tsc --noEmit -p tsconfig.json` → **0**
- `npm run lint` → **0 erreur** (2485 avertissements, tous préexistants ; `npx eslint` sur les
  9 fichiers neufs/modifiés : silence complet)
- `git diff --check` → **0**
- `npm run build` → OK (`dist/` produit)

### Essai headless

Serveur lancé depuis le worktree, **HOME isolé** (`_qa/mem/home`) — `~/.codebuddy` est
hors limites pour cette mission :

```
HOME=<worktree>/_qa/mem/home CODEBUDDY_MOBILE_PWA=true CODEBUDDY_CHANNEL_PROFILE=companion \
CODEBUDDY_COMPANION_PERSONA=copine CODEBUDDY_ROBOT_NAME=Lisa CODEBUDDY_PROVIDER=ollama \
OLLAMA_HOST=http://127.0.0.1:11435 GROK_MODEL=qwen3:4b-instruct JWT_SECRET=test-only \
node dist/index.js server --port 4101 --host 127.0.0.1 --no-auth
```

Client WS Node (`ws`), `assistant:'companion'`, deux tours sur la même connexion :

```
Q1  Coucou 💕
R1  Coucou ! 😄 Tu as l’air de bien te sentir aujourd’hui. 😊

Q2  tu te souviens de ce que je viens de dire ?
R2  Oui, j’ai bien entendu. Tu m’as dit « coucou » — et je t’attends, comme d’habitude. 💕
```

- **R1** : l'utilisateur n'est **pas** appelé Lisa, et le ton n'est pas celui d'un assistant
  de service. Le symptôme n° 3 est levé.
- **R2** : la réponse **cite le tour précédent**. Le symptôme n° 2 est levé à la racine.

Serveur arrêté par PID (`kill 655271 655273`), port 4101 libéré (`ss -ltnp` : plus rien).

Note de mesure : un premier essai avec `GROK_MODEL=qwen3.8-ctx32k:latest` a dépassé le
délai de tour de 120 s sur cette machine (modèle de 18 Go sur iGPU). Ce n'est pas un
défaut du code — le tour partait bien vers le fournisseur configuré ; l'essai a été
refait avec `qwen3:4b-instruct`. Cela vaut d'être noté pour l'exploitation : le
`CODEBUDDY_CHANNEL_TURN_TIMEOUT_MS` par défaut (180 s côté canaux) et le délai du
gestionnaire WS (120 s) sont serrés pour un gros modèle local.

## 6. Points d'attention pour l'exploitation

1. **`CODEBUDDY_USER_NAME`** : à poser côté service comme prévu. Sans elle, tout
   fonctionne — Lisa dit « la personne que tu aimes » et ne devine aucun prénom.
2. **Persistance** : active par défaut, `~/.codebuddy/companion/mobile-history/<sha256>.json`,
   `0600`. `CODEBUDDY_MOBILE_HISTORY=false` pour n'avoir que la mémoire de connexion.
3. **Sans authentification** (`--no-auth`), il n'y a pas d'identité : la mémoire vit dans la
   connexion seulement et rien n'est écrit. C'est ce qu'on a observé pendant l'essai.
4. Le délai de tour WS (120 s) mérite d'être relevé si le service mobile pointe un gros
   modèle local. Hors périmètre de cette mission, non touché.

## 7. Bilan (10 lignes)

1. Les trois symptômes du téléphone étaient un seul défaut : la PWA parlait à une autre Lisa que Telegram.
2. `runCompanionTurn` est désormais l'unique chemin compagnon ; `defaultReply` reste la voix, intacte.
3. Le fournisseur vient de `resolveCommandProvider`, plus du routage « modèle le plus rapide ».
4. La conversation vit par connexion (≤ 20 tours, texte seul) et survit à une reconnexion, opt-out.
5. Aucun octet d'image, aucune identité en clair : nom de fichier haché, traversal impossible.
6. Les relances elliptiques sont reconnues, mais seulement après un selfie réellement servi.
7. Telegram enregistrait ses selfies nulle part : corrigé, avec test rouge prouvé.
8. L'invite système dit qui est qui, sans prénom en dur et sans en inventer un.
9. Preuves : 2896 tests verts, 0 rouge, tsc 0, lint 0 erreur, `diff --check` 0, build OK.
10. L'essai headless montre les deux réponses attendues : pas de « Lisa », et la mémoire du tour d'avant.
