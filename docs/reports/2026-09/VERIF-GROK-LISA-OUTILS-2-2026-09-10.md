# VERIF-GROK-LISA-OUTILS-2 — Seconde vérification par exécution « Lisa outillée » après correctifs

- **Date** : 2026-09-10
- **Auteur** : Grok 4.6
- **Clone / branche** : `agy/lisa-outils-identifie-2026-09-10`
- **HEAD vérifié** : `0fb31313446c55442098a878af3f5f89704169b2`
- **Rapport 1** : `docs/reports/2026-09/VERIF-GROK-LISA-OUTILS-2026-09-10.md` (`VERDICT: NON PUSHABLE`)
- **Correctifs** : section 7 de `docs/reports/2026-09/LISA-OUTILS-IDENTIFIE-AGY-2026-09-10.md` (commits `7b8787ccf`, `4d8e1e2d8`, `27f5e5313`, `9b9eb8ccd`, `0fb313134`)
- **HOME QA** : `_qa/verif-lisa-outils/home` (non suivi)
- **Règle** : aucun fichier de code modifié. Ce rapport est le seul livrable. Aucun push. ComfyUI 8188/8189 non sollicités (`it.skip` du live).

Stub créé **avant inspection**. Index Code Explorer déjà **à jour** sur HEAD (`status` : commit `0fb313134`, 6879 fichiers, 135045 nœuds). MCP `list_repos` ne contient pas ce clone → `context` MCP = « Repository not found » ; requêtes en CLI `--repo`.

---

## 0. Outillage / index

- **Index** : **à jour** au démarrage (`0fb313134` = `git rev-parse HEAD`). Pas de `--force` (index local déjà aligné).
- **Appels Code Explorer (context/impact/query)** : 6 CLI réussis (`context` `getCompanionToolNames`, `resolveVoiceRobotNamed`, `resolveCompanionIdentity` ; `impact` `getCompanionToolNames`, `resolveVoiceRobotNamed` ; `query` ×1, bruit CSV parse) + 1 MCP `context` en échec registre + 1 MCP `list_repos`.
- **lm-resizer** : 3 commandes `exec --raw-on-failure --json` (`timeout 900 npm test -- tests/companion|channels|sensory`).
- **Octets économisés** : 15 502 + 11 734 + 14 146 = **41 382** (volumes de sortie, pas des tokens).
- **index : à jour** avant revue ; à réindexer après ce commit documentaire.

Graphe (à recouper par `rg`, relations dynamiques absentes du graphe) :

- `getCompanionToolNames` → `isForbiddenCompanionTool` ; appelé par `executeCompanionTool` / `getCompanionToolDefinitions` / `runCompanionChannelTurn`.
- `resolveVoiceRobotNamed` appelé par `defaultReply` (plus aucun `robotNamed: true` dans `src/`).
- `setVoiceResponseDecider` câblé dans `src/server/index.ts` (session partagée avec la voix).

---

## 1. Épreuve 1 — surcharge csv outils d'écriture/exécution (owner ET present)

Exécuté (pas lu) : `HOME=_qa/verif-lisa-outils/home npx tsx _qa/verif-lisa-outils/epreuves.mts` (non commité).

Coupe-circuit ON, csv **exact** de la mission :

`str_replace,multi_edit,bash,write_file,apply_patch,mcp_x`

| Rôle | Liste résultante | `str_replace` / `multi_edit` / `bash` / `write_file` / `apply_patch` / `mcp_x` |
| --- | --- | --- |
| owner | `[]` | **tous refusés** (`inList=false`, `isForbidden=true`, `executeCompanionTool` → `success=false`, « strictly forbidden ») |
| present | `[]` | **idem, 6/6 refusés** |

Rejeu du csv de la vérif 1 (`image_generate,bash,write_file,create_file,apply_patch,mcp_foo,fleet_ping,peer_delegate,str_replace,multi_edit,view_file`) :

| Rôle | Liste | Fuites (`str_replace`/`multi_edit`/`view_file`) |
| --- | --- | --- |
| owner | `["image_generate"]` | **aucune** (intersection : plus de remplacement du jeu de rôle) |
| present | `["image_generate"]` | **aucune** |

Le trou B de la vérif 1 (`str_replace` / `multi_edit` passaient pour owner) **est fermé**. `EPREUVE1_FAILS=0`.

---

## 2. Épreuve 2 — voix sans nom du robot ⇒ guest

`rg 'robotNamed:\s*true' src` : **0** (les seuls `true` restants sont des cas positifs de tests).

`defaultReply` appelle `await resolveVoiceRobotNamed(heard, replyOpts)` puis `resolveCompanionIdentity({ channel:'voice', isVoicePresence:true, robotNamed })`. Plus de constante.

Exécuté avec `createResponseDecider({ robotName: 'Lisa' })` (même contrat que le test, hors Vitest) :

| Phrase | `resolveVoiceRobotNamed` | Identité | Tour injecté |
| --- | --- | --- | --- |
| « quel temps fait-il aujourd’hui ? » | `false` | `guest` / `voice_unauthenticated_or_unnamed` | `toolsLen=0` `tool_choice=none`, `executedTools=[]` |
| « Lisa, quel temps fait-il ? » | `true` | `present` / `voice_presence_and_robot_named` | (contrôle positif, pas d’outils demandés ici) |

Câblage serveur : `setVoiceResponseDecider(responseDecider)` dans `src/server/index.ts`. Le trou B « `robotNamed: true` hardcodé » **est fermé**. `EPREUVE2_FAILS=0`.

---

## 3. Épreuve 3 — suites Vitest une à une (`timeout 900`)

Commande réelle (HOME QA isolé, `lm-resizer exec --raw-on-failure --json -- bash -c 'export HOME=…; timeout 900 npm test -- <dir>'`). Cette session a `CI=true` (environnement agent) ; ComfyUI 8188 en écoute **non frappé** (`it.skip`).

| Suite | exit | Fichiers | Tests | Durée | CCR |
| --- | --- | --- | --- | --- | --- |
| `tests/companion` | **0** | 91 passed / 1 skipped (92) | **846 passed** / 1 skipped (847) | 4.74 s | `38878d94a0e4d58cee13e483` |
| `tests/channels` | **0** | 67 passed / 2 skipped (69) | **1521 passed** / 9 skipped (1530) | 26.72 s | `9d3efb2c315d650c6181b211` |
| `tests/sensory` | **0** | 84 passed / 1 skipped (85) | **780 passed** / 4 skipped / 1 todo (785) | 7.05 s | `8b25e02b3537db945ed37363` |

**0 failed** sur les trois suites.

Skip expliqués (environnement, pas un rouge) :

- companion : `gk23-rappels-reel.test.ts` `describe.skipIf(!piperProbe.available)` — Piper absent du HOME QA (`…/home/DEV/ai-stack/voice/voices/fr_FR-siwis-medium.onnx`).
- channels fichiers skippés : `companion-channel-live.test.ts` (`RUN_OLLAMA_LIVE !== '1'`) + `nostr-transport.test.ts` (`describe.skipIf(process.env.CI)`, ici `CI=true`).
- channels tests skippés (9) : live Ollama 1 + Nostr 6 + `it.skip` ComfyUI 1 + GK10 stranger `skipIf(!hasOllamaModel('qwen2.5:1.5b-instruct'))` 1.
- sensory : identique au décompte agy (780 / 4 skip / 1 todo).

Totaux mesurés : **3147 passed + 14 skipped + 1 todo = 3162** (même total que agy 3155+6+1). Écart 8 skips de plus = Piper QA 1 + Nostr/`CI=true` 6 + GK10 modèle 1. Ce n’est pas un échec de la lane.

Écart vs agy §7.3 : agy a annoncé companion **847/0 skip** et channels **1528/2 skip** — vraisemblable sans HOME isolé (Piper présent) et sans `CI=true`. Les totaux de tests (847 / 1530 / 785) **concordent**.

---

## 4. Hygiène du diff

`git diff --stat origin/main..HEAD` : **17 files, 2777 insertions, 49 deletions**.

`git diff --check origin/main..HEAD` : 2 blancs en fin de fichier (`docs/mobile-pwa.md:119`, rapport AGY:198) — cosmétique, déjà noté en vérif 1, **non corrigé**.

| Motif | Dans `src/` + `tests/` de `origin/main..HEAD` ? |
| --- | --- |
| `/home/` | **non** |
| `senderUsername: '@PatriceDev'` | **non** (`@ownerhandle` / `ownerhandle`) |
| `userId: 'patrice'` / `CODEBUDDY_OWNER_USER_ID: 'patrice'` | **non** (`owner-user`, `owner-uuid-1234`) |
| Commentaire `alert Patrice on Telegram` | **non** (`alert owner on Telegram`) |
| `robotNamed: true` dans `src/` | **non** |

Les mentions `@PatriceDev` / `patrice` restantes sont **uniquement** dans le rapport de vérif 1 (citation des trouvailles), pas dans le produit.

---

## 5. Écarts vs rapport AGY §7 / §8

| Affirmation AGY | Mesure |
| --- | --- |
| surcharge bornée + liste noire familles | **oui** (épreuve 1, owner **et** present) |
| `robotNamed` réel via respond-decider | **oui** (épreuve 2 + câblage `defaultReply` / `setVoiceResponseDecider`) |
| tests companion 847 passed / 0 skipped | **846 passed / 1 skipped** (Piper HOME QA) ; total 847 |
| tests channels 1528 passed / 2 skipped | **1521 passed / 9 skipped** (`CI=true` Nostr + GK10 modèle) ; total 1530 |
| tests sensory 780 / 4 skip / 1 todo | **identique** |
| 3155/3162 passed | **3147/3162 passed**, 0 failed |
| live ComfyUI `it.skip` | **oui** (8188 en écoute, non contacté) |

---

## 6. Verdict

Les trois épreuves demandées **tiennent** : csv write/exec refusé pour owner et present ; voix sans nom → guest / 0 outil ; suites companion + channels + sensory **0 failed**. L’hygiène produit (ids personnels, `robotNamed` hardcodé) est propre. Les skips supplémentaires vs agy sont l’environnement de cette session (`CI=true`, HOME QA sans Piper, modèle GK10 absent), pas un trou de la lane. Deux EOF blancs docs restent cosmétiques.

**VERDICT: PUSHABLE**

===LANE_GROK_VERIF_LISA_OUTILS2_TERMINE===
