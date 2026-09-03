# RAPPORT-GK35 — Serveurs MCP et Code Explorer en vrai : `.codebuddy/mcp.json`, `buddy import`, `code_explorer_ask`, délais de démarrage

Date : 2026-09-03 (Europe/Paris)
Agent : Grok 4.6
Clone : `/home/patrice/DEV/cb-repar-server-2026-09-02`
Branche : `fix/gk35-mcp-reel-2026-09-03`
HEAD au départ : `1ecb8a07e` (`Merge IMG1/IMG2 (pilote Grok Imagine durci : arrêt au 403, en-têtes, jeton masqué) into codex/audit-systeme-nerveux-2026-09-01`)
Réservation : `268fb2d23`
HEAD produit : `c5cfcf46b` (`docs(gk35): consigner MCP/Code Explorer en vrai et libérer le chantier`) — le hash de *ce* commit de HEAD suit en `docs(gk35): record product HEAD`.
Original `~/code-buddy` : interdit (jamais ouvert, jamais écrit)
Rapport créé **avant toute inspection** du code MCP / Code Explorer.
Buddy invoqué depuis le clone : `_qa/gk35/buddy.sh` → `node_modules/tsx/dist/cli.mjs src/index.ts`
HOME temporaire : `_qa/gk35/home`. Les invocations CLI forcent ce HOME.
Ollama local uniquement (`http://127.0.0.1:11434`, `qwen3:4b-instruct`). Aucun service systemd. ComfyUI 8188/8189 non touché.
Pont sensoriel 8129 et ports du robot : jamais.

## Mission

Éprouver **pour de vrai** le parcours MCP + Code Explorer, à partir du fait mesuré sur le robot :

> Au démarrage, `Failed to initialize MCP server pdfcommander … init timed out after 15000ms — skipped` et idem `cowork-pilot` (deux serveurs MCP lents → 30 s de démarrage perdus, outils absents sans que l'utilisateur le sache).

Parcours imposé :

1. Un serveur MCP factice local (stdio) **rapide** et un **lent** (> 15 s) → le lent est sauté avec un message clair **ET** reconnecté en arrière-plan quand il finit par répondre (délai `CODEBUDDY_MCP_INIT_TIMEOUT_MS`).
2. Les outils MCP apparaissent dans `/tools` et sont appelables par l'agent headless.
3. `buddy import` d'un `mcp.json` Claude Code fusionne sans doublon.
4. `code_explorer_ask` sur le clone (binaire `code-explorer` présent en lecture seule).
5. `buddy research ingest-code` sur le dépôt jouet.

Chaque défaut : test rouge → correctif → vert, un commit.

## Garde-fous

- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Aucune API payante. Aucun service systemd. ComfyUI 8188/8189 non touché.
- HOME temporaire dans le clone seulement.
- Original `~/code-buddy` interdit.
- Jamais le pont 8129 ni les ports du robot.

## Journal

### 2026-09-03 13:48 — création du rapport (avant inspection)

HEAD `1ecb8a07e`. Arbre propre. Réservation `268fb2d23`.

### Inspection (après réservation)

- `src/mcp/client.ts` : `ensureServersInitialized` lance les serveurs **en parallèle** avec `Promise.race` 15 s (`CODEBUDDY_MCP_INIT_TIMEOUT_MS`). Après timeout, `addServer` continue mais n'est plus écouté ; `initializationPromise` est remis à `null`. Un second appel (constructeur agent puis listing d'outils / `getMCPReady`) **re-attend le même handshake** → 15 s + 15 s = 30 s.
- Message utilisateur : `Failed to initialize MCP server X` + `init timed out after 15000ms — skipped` (celui du robot). Pas de mention d'arrière-plan, pas d'événement quand le serveur finit par répondre.
- `/tools` (`handleTools`) appelle `getAllCodeBuddyTools()` sans attendre MCP hors headless.
- `buddy import` fusionne `.mcp.json` et `.claude/settings.json`, **pas** `.claude/mcp.json`.
- `code_explorer_ask` appelle `query` sans `repo`. Avec plusieurs graphes, Code Explorer refuse. Un résultat MCP vide tombait sur « missing endpoint ».
- `ingest-code` default ops `hotspots`/`get_insights` vides sur un jouet → message « non connecté ». `list_repos` `[]` était ingéré comme une découverte.
- `.codebuddy/mcp.json` pointait `/home/patrice/DEV/gitnexus-rs/...` et `/home/patrice/code-buddy/src`. Binaire réel : `/home/patrice/.local/bin/code-explorer`.

## Parcours réel (après correctifs)

HOME `_qa/gk35/home`. Ollama `qwen3:4b-instruct`. Fixture stdio `tests/fixtures/mcp-delay-fixture.mjs`.

| Commande | Obtenu |
|---|---|
| Dual init `CODEBUDDY_MCP_INIT_TIMEOUT_MS=400`, lent 2000 ms | `firstMs: 407`, `secondMs: 0`, warn *background*, puis `slow connected after the 400ms init skip — 2 tool(s)`. Echo `MCP_REAL_FIXTURE:GK35` / `LATE`. |
| `buddy mcp test gk35_fast` | `Successfully connected` · 2 tools (`echo_marker`, `sum_pair`). |
| `buddy import --from claude-src` | `existing` conservé, `claude-live-nimbus` importé. 2ᵉ run : 0 serveur. |
| Headless `-p` + `--allowed-tools mcp__gk35_fast__echo_marker` | Tool 36 ms, `GK35-OK confirmed.`, `$0`, 5468/43 tokens. Lent sauté à 2 s puis reconnecté. 21,13 s, exit 0. |
| `code_explorer_ask` `greet` sur le jouet | `Function greet` `src/greet.ts:1-3`. |
| `code_explorer_ask` timeout MCP sur `src/mcp` | `ensureServersInitialized` + `MCPManager` dans `client.ts`. |
| `buddy research ingest-code --repo <toy>` | 4 insights (report, coverage, find_cycles, hotspots) → 5 nœuds CKG. |

Le clone entier n'a pas été indexé : un `code-explorer analyze .` lancé par erreur sous le vrai HOME a été **arrêté** (pid 1280074) pour ne pas polluer le registre global. Tranche indexée sous HOME isolé : `src/mcp` (20 fichiers, 501 nœuds).

## Défauts, rouge → vert

| Id | Défaut | Rouge | Commit |
|---|---|---|---|
| D1 | 2ᵉ `ensureServersInitialized` re-attend le timeout ; pas de reconnexion annoncée | 2ᵉ vague 200 ms (timeout 200) ; `/background/` absent ; `serverLateReady` timeout 5 s | `a4d1d09f6` |
| D2 | `/tools` liste avant la fin du handshake | `mcp__gk35_tools__echo_marker` absent sans attente | `9a91ff4d2` |
| D3 | `buddy import` ignore `.claude/mcp.json` | `mcpServersImported` 0 | `2652998c5` |
| D4 | `code_explorer_ask` sans `repo` | `listRepos` jamais appelé | `f8984c10b` |
| D5 | `ingest-code` accuse MCP d'être down sur un graphe jouet | 0 insight, message « non connecté » | `6650ba9b1` |
| D6 | MCP connecté + query vide → « missing endpoint » | notes `missing endpoint` | `a1020bc2b` |
| D7 | `list_repos` `[]` ingéré comme insight | découverte `[]` | `3c1ad67b8` |
| D8 | Doc / `mcp.json` : chemin privé `gitnexus`, pas de timeout | `buddy mcp test gitnexus`, `/home/patrice/DEV/gitnexus-rs` | `aab8304b3` |

## Tableau final

| Scénario | Attendu | Obtenu avant | Correctif | Commit |
|---|---|---|---|---|
| MCP stdio rapide + lent | Lent sauté clairement, outils du rapide présents, lent reconnecté plus tard ; 2ᵉ init instantanée | Timeout 15 s × 2 vagues = 30 s ; outils du lent absents sans suite | Skip `connecting` ; `watchLateConnect` ; `CODEBUDDY_MCP_INIT_TIMEOUT_MS` testé | `a4d1d09f6` |
| `/tools` | Outils `mcp__*` listés | Course avec l'init | `handleTools` attend `initializeMCPServers` | `9a91ff4d2` |
| Agent headless appelle un outil MCP | Appel réel, `$0` | (non éprouvé ici avant) | Même init + opt-in `CODEBUDDY_DISABLE_MCP=false` | preuve live, pas de commit dédié |
| `buddy import` Claude Code | Fusion sans doublon | `.claude/mcp.json` ignoré | Chemin ajouté ; noms existants conservés | `2652998c5` |
| `code_explorer_ask` | Réponse graphe pour cwd / `repo` | Échec multi-repos ou « missing endpoint » | Résolution `list_repos` + rester sur MCP | `f8984c10b` `a1020bc2b` |
| `research ingest-code` jouet | Insights CKG | « non connecté » / `[]` | Ops `report`/`coverage` ; ignorer `[]` | `6650ba9b1` `3c1ad67b8` |
| Doc + `mcp.json` | `code-explorer` sur PATH, timeout documenté | `gitnexus` + chemins `/home/patrice/...` | CLAUDE.md, integration, entrée portable | `aab8304b3` |

## Vérifications

- Union ciblée : 7 fichiers / 74 tests verts (`client` MCP, stdio timeout, `/tools`, import, ask, ingest source, docs).
- Voisins : `tests/mcp/client.test.ts` 54 ; `gk35-stdio-timeout` 1 ; `import` 8 ; `code-explorer-tool` + ask 10 ; `code-explorer-source` 5 ; `knowledge-ingest` 15.
- `tsc --noEmit -p tsconfig.json` exit 0 ; `tsconfig.gpuNode-identity.json` exit 0.
- ESLint ciblé `--max-warnings=0` exit 0 (le fichier historique `tests/mcp/client.test.ts` a 7 warnings préexistants, non retouchés hors GK35).
- `git diff --check` exit 0.
- Live dual-init, import, headless, ask, ingest-code : voir tableau ci-dessus.
- Suite complète ~27 k tests : non lancée.

## Reste ouvert

- `pubcommander` dans `.codebuddy/mcp.json` pointe encore `/home/patrice/DEV/PubCommander/...` (hors mission, config auteur).
- Index Code Explorer : catalogue **scopé au HOME**. Un HOME temporaire ne voit pas les graphes du vrai `~/.codeexplorer` ; il faut `code-explorer analyze` sous ce HOME. Le clone entier n'est pas indexé ici.
- `pdfcommander` / `cowork-pilot` du robot non relancés (ports robot interdits).
- `CODEBUDDY_DISABLE_MCP` reste `true` par défaut en `buddy -p` (documenté, inchangé).

## Bilan (10 lignes max)

Les 30 s du robot viennent de **deux vagues d'init** sur les mêmes serveurs lents, pas de deux timeouts séquentiels dans une seule vague. Après correctif, un init dual mesuré fait 407 ms puis 0 ms, le lent se reconnecte, les outils arrivent. `/tools` attend le handshake. `buddy import` fusionne `.claude/mcp.json` sans écraser. `code_explorer_ask` résout le `repo` et ne ment plus sur un endpoint HTTP. `ingest-code` a posé 4 insights sur le jouet. Preuve headless : `mcp__gk35_fast__echo_marker` en 36 ms, `GK35-OK confirmed.`, `$0`. `tsc` 0, ESLint ciblé 0, 74 tests GK35 verts. Aucun push. `~/code-buddy`, 8129 et 8188 intacts.
