# RAPPORT VERIF1 — vérification croisée par MUTATION des lanes fusionnées le 03/09

Date : 2026-09-03
Agent : Grok 4.6 (vérificateur, **pas** l'auteur des lanes)
Clone : `/home/patrice/DEV/cb-verif1-2026-09-03`
Branche : `verif/verif1-mutation-2026-09-03`
HEAD de départ : `6c6e43b58`
HEAD rapport vide : `2bec67f01`
Lanes visées : GK34, GK35, GK36, FLOTTE1 (fusionnées sur `codex/audit-systeme-nerveux-2026-09-01`)

Ce rapport a été créé **avant** toute inspection, puis complété au fil des mutations. Rien n'a été réparé.

## Pourquoi

Le 02/09, une vérification par mutation a trouvé **14 défauts encore ouverts derrière 26 correctifs annoncés « verts »**. Un test qui ne peut pas rougir ne prouve rien. Quatre lanes viennent d'être fusionnées sur la seule foi de leurs rapports.

## Contraintes

- Clone uniquement. Original `~/code-buddy` interdit en écriture.
- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Aucune API payante, aucun systemd, robot, `~/.codebuddy` réel, ComfyUI 8188/8189.
- Une mutation à la fois. Restauration `git checkout -- <fichier>`. Pas de `it.skip`.

## Tableau des mutations

| # | Lane | Contrat | Fichier:ligne | Mutation | Résultat | Commande |
|---|---|---|---|---|---|---|
| 1 | GK34 | Verifier refuse `CONFIRMED` sans oracle | `src/agent/specialized/verifier-agent.ts:287` | `claimedConfirmed && loop.oracleCount > 0` → `claimedConfirmed` | ROUGE attendu (`CONFIRMED` au lieu de `NEEDS REVIEW`) | `npx vitest run tests/unit/verifier-agent.test.ts -t "refuses CONFIRMED when the model never ran an oracle"` |
| 2 | GK34 | `/batch` ne lance pas deux unités du même fichier en parallèle | `src/commands/handlers/batch-handlers.ts:152` | `if (left === right) return true` → `return false` | ROUGE attendu (`maxConcurrent` 2 au lieu de 1) | `npx vitest run tests/commands/gk34-batch.test.ts -t "does not run overlapping file units concurrently"` |
| 3 | GK34 | `/batch` `/team` dispatchés en headless (fonction) | `src/commands/headless-slash.ts:100` | `isSpecialCommandToken(...)` → `!isSpecialCommandToken(...)` | ROUGE attendu (`handled` false, passToAI) | `npx vitest run tests/commands/gk34-headless-slash.test.ts` |
| 4 | GK34 | Slash CLI `buddy -p "/batch"` non envoyé au LLM | `src/index.ts:1133` | `if (prompt.trim().startsWith('/'))` → `if (!prompt.trim().startsWith('/'))` | **VERT = trouvaille** (19+33 tests headless restent verts) | `npx vitest run tests/commands/gk34-headless-slash.test.ts tests/commands/headless-slash.test.ts tests/commands/headless-slash-integration.test.ts` + `tests/unit/headless.test.ts` |
| 5 | GK35 | MCP lent sauté (démarrage n'attend pas) | `src/mcp/client.ts:314` | `await Promise.race([connect, timeout])` → `await connectPromise` | ROUGE attendu (1503 ms ≥ 800 ms) | `npx vitest run tests/mcp/client.test.ts -t "honors CODEBUDDY_MCP_INIT_TIMEOUT_MS: fast server loads, slow is skipped"` |
| 6 | GK35 | MCP lent reconnecté en arrière-plan | `src/mcp/client.ts:329` | `watchLateConnect(...)` → `void connectPromise.catch(...)` | ROUGE attendu (timeout 5000 ms, pas d'événement `serverLateReady`) | `npx vitest run tests/mcp/client.test.ts -t "registers tools in the background once a skipped server finally responds"` |
| 7 | GK35 | `/tools` attend l'init MCP | `src/commands/handlers/vibe-handlers.ts:170` | `await initializeMCPServers()` → `void initializeMCPServers()` | ROUGE attendu (liste sans `mcp__gk35_tools__echo_marker`) | `npx vitest run tests/mcp/gk35-tools-list.test.ts` |
| 8 | GK35 | `buddy import` `.claude/mcp.json` sans doublon | `src/commands/import.ts:562` | `if (existingNames.has(...))` → `if (false && existingNames.has(...))` | ROUGE attendu (libellé), **données encore `keep-me`** (2ᵉ garde `claimedNames`) | `npx vitest run tests/commands/import.test.ts -t "imports a Claude Code .claude/mcp.json without overwriting existing names"` |
| 9 | GK36 | Accueil : filtre jargon **global** | `src/sensory/arrival-opener.ts:180` | `isJargonArrivalLine` → `return false` | ROUGE attendu (la phrase XML+/100/évolution n'est plus `null`) | `npx vitest run tests/companion/gk36-compagnon-relationnel.test.ts -t "refuse une phrase d’accueil LLM qui récite le jargon"` |
| 10 | GK36 | Accueil : filtre **XML** seul `/<[^>]+>/` | `src/sensory/arrival-opener.ts:162` | retirer `/<[^>]+>/` du regex | **VERT = trouvaille** | même commande |
| 11 | GK36 | Accueil : filtre **score** seul `/\/100/` | `src/sensory/arrival-opener.ts:162` | retirer `/\/100/` du regex | **VERT = trouvaille** | même commande |
| 12 | GK36 | Accueil : filtre **auto-évolution** seul `j'ai appris à` | `src/sensory/arrival-opener.ts:162` | retirer `\bj['']ai appris à` du regex | **VERT = trouvaille** | même commande |
| 13 | GK36 | Proactif muet si la bouche est prise | `src/companion/proactive-engine.ts:332` | `if (present && speaking)` → `if (false && ...)` | ROUGE attendu (une phrase est dite) | `npx vitest run tests/companion/gk36-compagnon-relationnel.test.ts -t "reste muet si la bouche est déjà prise"` |
| 14 | GK36 | `MIN_GAP` y compris Telegram | `src/companion/proactive-engine.ts:395` | `if (!conductor.claim('proactive'))` → `if (false && !conductor.claim(...))` | ROUGE attendu (Telegram envoie malgré `arrival`) | `npx vitest run tests/companion/gk36-compagnon-relationnel.test.ts -t "au plus une initiative par fenêtre MIN_GAP"` |
| 15 | GK36 | Épisode du jour : faits saillants, pas les 6 derniers tours | `src/sensory/episodic-journal.ts:67` | `distinct.filter(isSalientHeard).slice(-6)` → `[]` | ROUGE attendu (ligne = 6 derniers tours, plus de train) | `npx vitest run tests/companion/gk36-compagnon-relationnel.test.ts -t "consolide 20 énoncés"` |
| 16 | FLOTTE1 | `verify` refuse une signature Ed25519 falsifiée | `scripts/lane-ledger.mjs:247-250` | retirer `!verify(...)` | ROUGE attendu (exit 0 au lieu de 3) | `npx vitest run tests/scripts/lane-ledger.test.ts -t "rejects an altered Ed25519 signature"` |
| 17 | FLOTTE1 | `verify` refuse un chaînage `prev_hash` falsifié | `scripts/lane-ledger.mjs:203` | `if (entry.prev_hash !== previousHash)` → `if (false && ...)` | **VERT = trouvaille** (10/10 restent verts) | `npx vitest run tests/scripts/lane-ledger.test.ts` |

Chaque ligne ROUGE a été restaurée (`git checkout -- <fichier>`) puis rejouée verte. Arbre de travail propre hors `node_modules` non suivi.

## Trouvailles

Classées par ce qu'elles permettraient en vrai. Une garde de sécurité qui ne garde rien passe avant une jolie phrase d'accueil.

### T1 — FLOTTE1 : le chaînage `prev_hash` peut disparaître sans qu'un test rougisse

- **Contrat annoncé :** une entrée dont le `prev_hash` ne colle pas à la ligne précédente est refusée par `verify`.
- **Mutation inaperçue :** `scripts/lane-ledger.mjs:203` — le `chainError(..., 'prev_hash invalide')` court-circuité. Suite complète `tests/scripts/lane-ledger.test.ts` = **10 passed**.
- **Ce que ça permet :** le seul test qui mentionne `prev_hash` (`lane-ledger.test.ts:206`) vérifie que `append` *écrit* le bon hash, jamais que `verify` *refuse* un chaînage cassé. Un attaquant qui possède une clé de signataire (moteur ou approval) peut recoller deux journaux indépendamment signés : chaque entrée a un `entry_hash` et une signature valides ; seul le lien `prev_hash` trahirait la soudure. Sans ce test, une régression (PR qui « simplifie » `verifyLines`) passerait CI. La signature, elle, est bien gardée (mutation #16 rouge, exit 0 au lieu de 3).

### T2 — GK34 : le câblage CLI réel n'est pas testé

- **Contrat annoncé :** `buddy -p "/batch|/swarm|/team …"` est dispatché en headless, pas envoyé au LLM comme du texte.
- **Mutation inaperçue :** `src/index.ts:1133` — inversion de `startsWith('/')`. Les tests `gk34-headless-slash` (5), `headless-slash` + integration (19) et `tests/unit/headless.test.ts` (33) restent verts. Aucun test n'importe le chemin CLI.
- **Ce que ça permet :** c'est *exactement* le bug live que GK34 disait avoir fermé. `dispatchSlashPrompt` est testé ; le `if` qui l'appelle depuis le headless CLI ne l'est pas. Une inversion, un copier-coller, ou HEADLESS1 qui touche `src/index.ts` peut renvoyer `/batch` au modèle. `/swarm` n'apparaît d'ailleurs dans aucun test de `dispatchSlashPrompt` (seulement le handler).

### T3 — GK36 : chaque filtre d'accueil peut mourir tout seul

- **Contrat annoncé :** l'accueil ne contient jamais de jargon XML, de score `/100`, ni de note d'auto-évolution non demandée — **mute chaque filtre**.
- **Mutation inaperçue :** le test LLM unique (`gk36-compagnon-relationnel.test.ts:166`) injecte *les trois* dans la même phrase (`<recent_episode>… J'ai appris à … (72/100)`). Retirer `/<[^>]+>/`, ou `/\/100/`, ou `j'ai appris à`, laisse le test vert : les autres alternatives du regex suffisent. Seul le mute *global* de `isJargonArrivalLine` rougit.
- **Ce que ça permet :** Lisa peut réciter un score `/100`, une balise XML anodine (`<pause>`), ou « j'ai appris à mieux écouter » dès que le payload de test ne contient plus le cocktail. Le test déterministe du soir (`buildArrivalOpener` sur un épisode déjà propre) ne voit jamais le filtre.

### T4 — GK35 import : le test rougit sur le libellé, pas sur le doublon

- **Contrat annoncé :** fusion `.claude/mcp.json` sans doublon / sans écrasement.
- **Mutation :** mute de `existingNames.has` (#8). Le test échoue parce que le résumé dit « doublon dans les sources, ignoré » au lieu de « nom déjà présent, conservé ». Les données restent `existing: { command: 'keep-me' }` grâce à `claimedNames`.
- **Ce que ça permet :** ce n'est pas une garde morte — la 2ᵉ condition empêche encore l'écrasement. Mais le test GK35 « `.claude/mcp.json` » ne prouve pas l'absence de doublon dans le fichier : il prouve un libellé. Un mute de `claimedNames` seul resterait vert sur *ce* test (la 1ʳᵉ garde classerait encore `existing`). La fusion multi-sources (`consolidates every supported rule source…`) est le vrai filet pour les doublons inter-fichiers ; elle n'est pas le test cité par le contrat `.claude/mcp.json`.

## Contrats qui tiennent (le test peut rougir)

Verifier sans oracle ; course `/batch` même fichier ; dispatch `dispatchSlashPrompt` pour `/batch` et `/team` ; saut MCP + événement de reconnexion tardive ; `/tools` attend l'init ; bouche occupée ; `MIN_GAP` Telegram ; faits saillants de l'épisode ; signature Ed25519 du journal.

Note : `watchLateConnect` n'enregistre pas les outils (déjà faits par `addServerInternal`) — il émet l'événement et le log. Le test #6 rougit parce qu'il attend l'événement, pas parce que les outils disparaîtraient.

## Journal

- Rapport vide + réservation : commit `2bec67f01`.
- 17 mutations, une à la fois, chacune restaurée. `git status` propre hors `node_modules` à chaque mute.
- Aucune réparation. Aucun push. `~/code-buddy`, ComfyUI, robot, `~/.codebuddy` réel intacts.

## Bilan

1. 17 mutations sur GK34/GK35/GK36/FLOTTE1 ; 5 **VERT = trouvaille**, 12 ROUGE attendu, tout restauré.
2. **T1 (sécurité)** : mute `prev_hash` → `lane-ledger.test.ts` 10/10 verts. Le journal chaîné n'a pas de test de `verify` contre un chaînage cassé.
3. **T2 (le bug GK34)** : mute `src/index.ts:1133` → 5+19+33 tests headless verts. `buddy -p "/batch"` peut retomber dans le LLM.
4. **T3** : XML, `/100`, « j'ai appris à » mutés séparément → le test d'accueil LLM reste vert (payload cocktail).
5. **T4** : mute dédup `existingNames` → rouge de libellé, fichier encore sans écrasement (`claimedNames`).
6. Contrats tenus : oracle Verifier, course `/batch`, `dispatchSlashPrompt`, skip MCP, `/tools` await, bouche, MIN_GAP Telegram, épisode saillant, signature Ed25519.
7. Preuves : commandes du tableau ; témoins vert → rouge → vert collés dans la session ; pas de `it.skip`.
8. Rien réparé. Ouvert : écrire des tests qui tapent `prev_hash` dans `verify`, le `if (startsWith('/'))` de `src/index.ts`, et chaque filtre d'accueil isolément.
9. Zones étrangères (MCPFIX1, HEADLESS1, SANDBOX1, TTFT1) non touchées hors mutes temporaires restaurées ici.
10. Branche `verif/verif1-mutation-2026-09-03`, aucun push, original `~/code-buddy` intact.
