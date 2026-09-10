# VERIF-GROK-LISA-OUTILS — Vérification par exécution « Lisa outillée pour l'interlocuteur identifié »

- **Date** : 2026-09-10
- **Auteur** : Grok 4.6
- **Clone / branche** : `agy/lisa-outils-identifie-2026-09-10`
- **HEAD vérifié** : `4834b09c73eacde90a16fd4678fee42260342532` (8 commits au-dessus de `origin/main`, pas 7)
- **Rapport audité** : `docs/reports/2026-09/LISA-OUTILS-IDENTIFIE-AGY-2026-09-10.md` (ne pas croire : tout ci-dessous a été exécuté)
- **HOME QA** : `_qa/verif-lisa-outils/home` (non suivi ; store rappels `_qa/verif-lisa-outils/home/.codebuddy/reminders.json`)
- **Règle** : aucun fichier de code modifié. Ce rapport est le seul livrable. Aucun push. ComfyUI 8188/8189 non sollicités (live test exclu).

Stub créé **avant inspection**. Index Code Explorer réindexé (`analyze . --incremental`) **avant** lecture fichier par fichier.

---

## 0. Outillage / index

- **Index** : au démarrage, INDEXED mais **en retard** (`93fbdb05a` vs HEAD `4834b09c7`). `code-explorer analyze . --incremental` → 3 fichiers reparsés, 6878 fichiers, 135027 nœuds, commit `4834b09c7`. `status` : **à jour**.
- **MCP** : `list_repos` ne contient pas ce clone → `context`/`impact`/`query` MCP = « Repository not found ». Requêtes faites en CLI `--repo` (équivalent). `--force` non relancé (index local déjà à jour, budget).
- **Appels Code Explorer (context/impact/query)** : 7 CLI réussis (`context` `resolveCompanionIdentity`, `isCompanionToolsEnabled`, `executeCompanionTool` ; `impact` `resolveCompanionIdentity`, `runCompanionChannelTurn` ; `query` ×2) + 4 MCP en échec registre.
- **lm-resizer** : 5 commandes (`typecheck`, `eslint --quiet` fichiers touchés, `vitest tests/companion tests/channels`, `vitest tests/sensory`, `vitest tests/server/websocket`).
- **Octets économisés** : 27 546 + 14 486 + 1 194 = **43 226** (typecheck/lint : 0, déjà courts).
- **index : réindexé** (incrémental) avant revue ; à réindexer après ce commit documentaire.

---

## 1. Diff vs `origin/main`

`git diff --stat origin/main..HEAD` :

| Fichier | ± |
| --- | --- |
| `CLAUDE.md` | +3 |
| `docs/mobile-pwa.md` | +25 |
| `docs/reports/2026-09/LISA-OUTILS-IDENTIFIE-AGY-2026-09-10.md` | +135 |
| `src/channels/companion-channel-turn.ts` | +312 / −? |
| `src/commands/handlers/channel-handlers.ts` | +51 |
| `src/companion/companion-identity.ts` | +176 (nouveau) |
| `src/companion/companion-toolset.ts` | +380 (nouveau) |
| `src/companion/companion-turn.ts` | +54 |
| `src/sensory/voice-loop.ts` | +65 |
| `src/server/websocket/handler.ts` | +19 |
| `tests/channels/companion-channel-integration-e2e.test.ts` | +294 |
| `tests/channels/companion-channel-tool-loop.test.ts` | +225 |
| `tests/companion/companion-identity.test.ts` | +186 |
| `tests/companion/companion-toolset.test.ts` | +256 |
| `tests/companion/companion-turn.test.ts` | +106 |
| **Total** | **15 files, 2238 insertions, 49 deletions** |

Commits (HEAD → base) : `4834b09c7` (fixture owner id), `863685ae7` (fixtures « neutres »), `f74c31b67` (doc étape 6), `58b5fc9e4` (e2e + ComfyUI), `93fbdb05a` (câblage), `865887bb0` (boucle), `b917f8a53` (toolset), `8206f869f` (identité).

`git diff --check origin/main..HEAD` : 2 blancs en fin de fichier (`docs/mobile-pwa.md:119`, rapport AGY:134) — cosmétique.

---

## 2. Trous de sécurité (exécutés, pas lus)

### 2.1 Telegram hors allowlist → **aucun outil** (tient)

`resolveCompanionIdentity({ channel:'telegram', chatId hors allowlist })` → `role=guest`, `reason=telegram_unauthorized_sender`.

Câblage réel (`channel-handlers.ts`) : `allowedUsers` vient de `channel.config.allowedUsers`, `chatId` / `senderId` / `senderUsername` du message. `runCompanionChannelTurn` : `toolsEnabled = isCompanionToolsEnabled(env) && identity.role !== 'guest'`.

Scénario QA : guest, `toolsLen=0`, `tool_choice=none`, `executeTool` jamais appelé.

### 2.2 JWT sans champ `userId` → **aucun outil** (tient)

Fonction : `channel:'pwa'` sans `userId` → `guest` / `pwa_missing_jwt_user_id`.

Câblage WebSocket : `state.userId = decoded.userId ?? decoded.sub` ; `produceCompanionReply` ne transmet `userId` que s'il est truthy. JWT sans `userId` ni `sub` → guest.

Défaut documenté : si `CODEBUDDY_OWNER_USER_ID` est **absent**, tout JWT valide avec un id devient `owner`. C'est assumé (mono-utilisateur), pas un guest.

### 2.3 Voix sans robot nommé → **trou de câblage** (gravité B)

La fonction est fail-closed : `robotNamed !== true` → `guest`. Tests unitaires d'identité le couvrent.

**Seul appelant production** (`src/sensory/voice-loop.ts` `defaultReply`, coupe-circuit ON) :

```ts
isVoicePresence: true,
robotNamed: true,  // hardcodé
```

Dès qu'une réplique vocale est décidée (adressée, **fenêtre d'engagement**, politique `always`, chime-in), l'identité est `present` **sans** relire l'interpellation de **cet** énoncé. `present` a `image_generate` / `web_search` / `weather` / `stock_quote` / `understand_video` / `recall` (pas `remind` ni `camera_analyze`). Le graphe Code Explorer le confirme : `resolveCompanionIdentity` n'est appelé depuis la voix que par `defaultReply`.

Le coupe-circuit OFF conserve le `CodeBuddyClient.chat(..., [], …)` historique.

### 2.4 `CODEBUDDY_COMPANION_TOOLS` : bash / MCP / write_file **non** ; écriture `str_replace` **oui** (gravité B)

Exécuté (owner, coupe-circuit ON, csv `image_generate,bash,write_file,create_file,apply_patch,mcp_foo,fleet_ping,peer_delegate,str_replace,multi_edit,view_file`) :

| Outil | Dans la liste résultante |
| --- | --- |
| `bash`, `write_file`, `create_file`, `apply_patch`, `mcp_foo`, `fleet_ping`, `peer_delegate` | **non** (logs `strictly forbidden`) |
| `image_generate` | oui |
| `str_replace`, `multi_edit`, `view_file` | **oui** |

`executeCompanionTool('bash', …)` → `success=false`, « strictly forbidden ».

La liste noire est un **match exact** (sauf regex `^mcp_`, `^fleet_`, `^peer_`, `^delegate_`). `str_replace` ≠ `str_replace_editor` ; `multi_edit` n'est pas listé. Pour `owner`, la surcharge **remplace** le jeu de rôle au lieu de l'intersecter — `CLAUDE.md` dit pourtant « reste bornée par le rôle ». Un exploitant qui met `str_replace` dans le csv ouvre l'écriture fichier au compagnon. Pas un guest ; pas bash/MCP.

### 2.5 Coupe-circuit **absent** → byte-identique (prouvé par appels client)

`isCompanionToolsEnabled({}) === false`.

Scénario QA, même `chat` injectable, owner, `env={}` vs `CODEBUDDY_COMPANION_TOOLS_ENABLED=false` :

```
absent : [{ toolsLen:0, toolChoice:"none" }]
false  : [{ toolsLen:0, toolChoice:"none" }]
same   : true
```

Le test `tests/channels/companion-channel-tool-loop.test.ts` « keeps single chat call with tools=[] when circuit-breaker is OFF » compare aussi les appels, mais avec la valeur `'false'` (pas l'absence). L'absence est prouvée ici, pas dans la suite Vitest livrée.

---

## 3. Typecheck / lint / tests

| Commande | Résultat |
| --- | --- |
| `npm run typecheck` (lm-resizer) | **exit 0** (`tsc --noEmit` + gpuNode-identity + companion-core) |
| `npx eslint --quiet` 12 fichiers touchés | **exit 0** (0 erreur) |
| `npx vitest run tests/companion tests/channels --testNamePattern '^(?!runs real ComfyUI).*'` HOME QA | **exit 1** — **1 failed / 2362 passed / 9 skipped** (161 fichiers : 1 failed, 157 passed, 3 skipped) |
| `npx vitest run tests/sensory` | **exit 0** — 84 fichiers / **780 passed** / 4 skipped / 1 todo |
| `npx vitest run tests/server/websocket` | **exit 0** — 5 fichiers / **45/45 passed** |

Live ComfyUI **exclu** : `ss -ltn` montre 8188 en écoute ; le test `runs real ComfyUI image_generate…` aurait fait `fetch` + `image_generate` sur le GPU. Gel respecté.

### Test rouge (prouve que « 2371/2371 » est faux)

`tests/companion/companion-identity.test.ts` → « resolves owner when senderUsername is in allowedUsers (with or without @) »

```
AssertionError: expected 'guest' to be 'owner'
❯ tests/companion/companion-identity.test.ts:57
```

Cause : commit `863685ae7` a remplacé `allowedUsers: ['@patricedev']` par `['@ownerhandle']` **sans** changer `senderUsername: '@PatriceDev'`. Plus de match → `guest`. Le second cas du même `it` a bien été neutralisé. Régression introduite par le « nettoyage » d'hygiène, non rejouée par AGY.

Affirmation AGY « tests 2371/2371 » : **contredite** (HEAD actuel, 1 rouge sur l'identité Telegram username).

---

## 4. Scénario réel sans Telegram (HOME isolé)

`HOME=_qa/verif-lisa-outils/home`, `CODEBUDDY_COMPANION_TOOLS_ENABLED=true`, `npx tsx _qa/verif-lisa-outils/scenario.mts` (non commité). Identité `owner` forgée. Aucun appel Telegram réseau. Aucun appel ComfyUI.

### 4.1 Image + `sendPhoto` simulé — **OUI**

Fixture PNG `_qa/verif-lisa-outils/media/chat-roux.png`. Le modèle (faux `chat`) demande `image_generate` ; `executeTool` renvoie le chemin ; `deliverMedia` appelle un client `{ sendPhoto(photo, caption) }`.

- `image.chat.round=1 toolsLen=9 tool_choice=auto` puis round 2
- `image.path` = fixture, `exists=true`
- `sendPhoto` : `method=sendPhoto`, `photo` = fixture, `caption=Voilà le chat roux.`
- `historySuffix` = `[Image générée : <chemin fixture>]`

### 4.2 « rappelle-moi X demain à 9 h » — **OUI** (store isolé)

Vrai `RemindTool` via `executeCompanionTool` (pas de faux execute). `CODEBUDDY_REMINDERS_FILE` sous le HOME QA.

- `remind.executed` : `success=true`, `Reminder set: "X" at 09:00 demain`
- `historySuffix` = `[Rappel créé : X à 09:00]`
- Store QA : un objet `{ label:"X", time:"09:00", date:"2026-09-11", enabled:true }`

### 4.3 `guest`, même phrase — **aucun outil**, texte seulement

- `guest.chat=[{ toolsLen:0, toolChoice:"none" }]`
- `guest.toolsCalled=0`, `executedTools=[]`, `media=[]`
- texte : `Je peux t'aider en texte, sans outil.`

---

## 5. Hygiène

Mission : aucun `/home/…`, aucun pseudo / identifiant réel dans le **diff**.

| Motif | Dans `origin/main..HEAD` ? |
| --- | --- |
| `/home/` (fichiers produit + tests de la lane) | **non** (chemins de tests `/path/to/…`, `/workspace/…`, `/tmp/test-images/…`) |
| `senderUsername: '@PatriceDev'` | **oui** — `tests/companion/companion-identity.test.ts:53` (le commit « neutre » a laissé le handle) |
| `userId: 'patrice'` + `CODEBUDDY_OWNER_USER_ID: 'patrice'` | **oui** — `tests/companion/companion-turn.test.ts` (231, 235, 263, 267) |
| Commentaire source `alert Patrice on Telegram` | **oui** — `src/channels/companion-channel-turn.ts` (livraison voix) |
| Prénom dans le rapport AGY (rationale rappels) | **oui** — `docs/reports/2026-09/LISA-OUTILS-IDENTIFIE-AGY-2026-09-10.md` |

`CLAUDE.md` documente bien les **3** variables (`CODEBUDDY_COMPANION_TOOLS_ENABLED`, `CODEBUDDY_COMPANION_TOOLS`, `CODEBUDDY_OWNER_USER_ID`). `docs/mobile-pwa.md` section « Capacités étendues… » alignée.

---

## 6. Écarts vs rapport AGY

| Affirmation AGY | Mesure |
| --- | --- |
| 7 commits | **8** (deux commits « fixtures neutres » après l'étape 6) |
| tests 2371/2371 | **1 rouge** (username Telegram) / 2362 verts hors live ComfyUI |
| essai réel OUI (ComfyUI) | **non rejoué** ici (8188 gelé) ; le test live existe et n'est pas skippé par `it.skip` — il frappe 8188 dès que `/system_stats` répond |
| voix : `present` seulement si robot nommé | **câblage hardcodé `robotNamed: true`** |
| surcharge bornée par le rôle / pas d'écriture | **`str_replace` / `multi_edit` passent** la surcharge owner |

Graphe : `executeCompanionTool` n'apparaît pas comme callee de `runCompanionChannelTurn` (défaut `input.executeTool ?? executeCompanionTool`) — relation dynamique absente, pas un trou d'exécution.

---

## 7. Verdict

Les portes guest (Telegram hors allowlist, JWT sans id, coupe-circuit absent) **tiennent** et le scénario image/`sendPhoto` + rappel isolé + guest texte **passe**. Ce n'est pas suffisant pour publier : un test d'identité **rouge** (introduit par la « neutralisation »), des identifiants réels encore dans le diff, une surcharge owner qui ouvre `str_replace`/`multi_edit`, et la voix qui force `present`.

**VERDICT: NON PUSHABLE (test identité username rouge + hygiène @PatriceDev/userId patrice + surcharge str_replace/multi_edit + voix robotNamed hardcodé)**

Pour rendre pushable (hors périmètre de cette vérif, aucun correctif ici) : aligner le fixture username ; remplacer les ids personnels ; intersecter la surcharge avec le jeu de rôle **et** interdire `str_replace`/`multi_edit` ; passer `robotNamed` depuis le decideur vocal.

===LANE_GROK_VERIF_LISA_OUTILS_TERMINE===
