## Verdict
ROUGE

Au sens strict, deux étapes sur six sortent en échec sur ce clone : `npm ci` et `npm run check:circular`. La suite Vitest compte 86 échecs.

Mais **aucune régression de test n'est imputable à la branche** : les 86 échecs disparaissent tous une fois neutralisée leur cause d'environnement (preuves ci-dessous), et aucun n'est instable. Le **seul défaut propre à la branche** est **une nouvelle dépendance circulaire** (17 cycles contre 16 sur `main`, voir §3). Ce contrôle n'est exécuté ni par la CI ni par `npm run validate`, donc il ne bloque pas la fusion.

En résumé : typecheck, lint et build sont **VERTS**. Les tests sont **verts après neutralisation de l'environnement**. Les cycles sont **ROUGES**, déjà sur `main`, avec un cycle de plus sur la branche.

## Conditions

| Élément | Valeur |
|---|---|
| Dépôt, branche | `phuetz/code-buddy`, `release/v2.3.0-2026-10-08` |
| Tête testée | `01c729484253b669880f4732c4420378d89d073e` (identique à la tête attendue `01c729484253e`) |
| Machine | Conteneur Linux x86_64 cloud, 4 vCPU, 15 Go de RAM, **exécution en root**, Node 22.22.2, npm 10.9.7, ni démon Docker ni `bwrap` |
| Réseau | Sortie via un proxy HTTP (`HTTPS_PROXY` défini) qui refuse plusieurs hôtes de téléchargement |
| Clone | Clone neuf de la branche, placé dans un dossier jetable **sous `/tmp`** |
| Environnement des tests | HOME jetable, `CI=true` ; aucun jeton ni clé API dans l'environnement ; variables d'agent IA présentes, puisque la session tourne dans Claude Code |
| Vitest | Suite entière en 6 tranches séquentielles (`--shard=i/6`), avec les réglages par défaut du dépôt |
| Modifications | **Aucune** dans le code testé. Seul un lien vers le `rg` du système a été ajouté dans `node_modules` pour un rejeu de diagnostic. Des copies jetables de deux tests, avec journalisation ajoutée, ont servi au diagnostic, puis ont été supprimées |

## 1. Étapes

| # | Commande | Code de sortie | Durée |
|---|---|---|---|
| 1 | `npm ci` | **1** | 76 s |
| 1b | `npm ci --ignore-scripts` (repli documenté dans `docs/install.md`) | 0 | 40 s |
| 1c | `npm rebuild better-sqlite3 sharp esbuild` | 0 | 2 s |
| 2 | `npm run typecheck` | **0** | 47 s |
| 3 | `npm run lint` | **0** (0 erreur, 2 602 avertissements) | 84 s |
| 4 | `npm run build` | **0** | 64 s |
| 5.1 | `npx vitest run --shard=1/6` | 1 | 179 s |
| 5.2 | `npx vitest run --shard=2/6` | 1 | 149 s |
| 5.3 | `npx vitest run --shard=3/6` | 1 | 143 s |
| 5.4 | `npx vitest run --shard=4/6` | 1 | 156 s |
| 5.5 | `npx vitest run --shard=5/6` | 1 | 253 s |
| 5.6 | `npx vitest run --shard=6/6` | 1 | 162 s |
| 6 | `npm run check:circular` | **1** | 35 s |

**Étape 1.** Le postinstall de `onnxruntime-node` (dépendance de `@huggingface/transformers`) télécharge un binaire et reçoit `Error: read ECONNRESET` : le proxy coupe l'hôte de téléchargement. Après le repli : `better-sqlite3` est compilé et fonctionne, `sharp` se charge. Restent sans binaire : `onnxruntime-node` et le `rg` embarqué de `@vscode/ripgrep`, dont le téléchargement depuis l'API GitHub est lui aussi refusé.

**Étape 5, totaux sur les 6 tranches :**

| Tests | Réussis | Échecs | Ignorés | À faire |
|---|---|---|---|---|
| **42 000** | **41 830** | **86** (27 fichiers) | 83 | 1 |

## 2. Échecs Vitest classés

### Méthode

1. **Passe 1** : la suite entière, 86 échecs.
2. **Passe 2** : les 27 fichiers en échec, rejoués **sans proxy** et avec le `rg` du système à la place du binaire embarqué manquant. Il reste 28 échecs.
3. **Passe 3** : les 28 restants rejoués à l'identique. **Mêmes 28 échecs, donc aucun test instable.**
4. **Passe 4** : rejeu depuis une copie de travail **hors de `/tmp`**. 8 tests de plus passent.
5. **Diagnostics ciblés** :
   - copies jetables de deux tests avec journalisation, pour voir la confirmation demandée et la sortie du processus enfant ;
   - rejeu sans `rg` mais sans proxy, pour départager proxy et ripgrep ;
   - rejeu du test d'isolation du HOME sans les variables d'agent IA.

### Bilan

| Catégorie | Tests | Statut |
|---|---|---|
| **Régression réelle** | **0** | — |
| **Test instable** | **0** | Les 28 échecs de la passe 2 se reproduisent à l'identique en passe 3 |
| **Dépendance à l'environnement** | **86** | Détail ci-dessous, par cause |

| Cause | Tests | Preuve |
|---|---|---|
| A. Binaire `rg` embarqué absent | 39 | Échecs `spawn …/@vscode/ripgrep/bin/rg ENOENT` ou recherche vide. Tout passe avec le `rg` système (passe 2). Sans `rg` mais sans proxy, les mêmes 34 tests des 11 fichiers concernés échouent à nouveau, plus 5 dans `secret-files-guard` |
| B. Proxy HTTP du conteneur | 19 | Tests du CLI headless qui parlent à un faux serveur LLM sur la boucle locale. Ils passent dès que `HTTPS_PROXY` est retiré. Le dispatcher global de `src/utils/proxy-support.ts` envoie ces appels locaux dans le proxy malgré `NO_PROXY` : **défaut produit déjà connu**, invisible en CI faute de proxy |
| C. Exécution en root | 10 | Chacun de ces tests simule un fichier illisible ou en lecture seule par `chmod`, sans garde pour root ; root écrit malgré `0444` (vérifié). **Non rejoué en utilisateur non root** : la création d'un utilisateur a été refusée par la politique de la session |
| D. Clone placé sous `/tmp` | 8 | Les 4 tests `workspace-isolation` et celui de `secret-files-guard` créent leur dossier témoin dans `tmp/` du dépôt et attendent un refus, or `/tmp` est toujours inscriptible pour le module d'isolation. Les 3 tests `remind-cli` passent aussi depuis la copie hors `/tmp` (cause exacte non isolée). Tous passent depuis une copie de travail hors de `/tmp` |
| E. Ni démon Docker ni `bwrap` | 9 | Journal ajouté : `Run command outside the workspace sandbox … Boundary: No native or Docker workspace sandbox is available`. Le test refuse cette confirmation d'escalade. Les runners GitHub ont Docker |
| F. Vitest en mode « agent IA » | 1 | Vitest 4 (`std-env`) détecte `CLAUDECODE` / `AI_AGENT` et masque la console des tests réussis ; le test attend la ligne `XDG_SOUS_HOME` écrite par un processus enfant. Sans ces variables : code 0, fichier vert |

**Deux fragilités de test à noter.** Elles ne relèvent pas de la branche, mais elles se reproduiront sur les postes de la flotte :
- la catégorie **C** n'a pas de garde `process.getuid() === 0` ;
- la catégorie **F** **échouera chaque fois que la suite est lancée par un agent** (Claude Code, Codex…) : le test dépend de l'affichage de la console d'un enfant Vitest.

### Liste complète des 86 échecs (passe 1)

Les chemins des dossiers jetables sont masqués.

#### A. Binaire ripgrep embarqué absent — 39 test(s)

| Fichier | Test | Message d’assertion exact (1re ligne) |
|---|---|---|
| `tests/catalog-verify-file-tools.test.ts` | File Tools Verification codebase_replace works | `AssertionError: expected false to be true // Object.is equality` |
| `tests/security/codebase-replace-secret.test.ts` | codebase_replace protège les secrets du projet ne montre pas le contenu de prod.env dans le dry-run de l’outil agent | `AssertionError: expected false to be true // Object.is equality` |
| `tests/security/codebase-replace-secret.test.ts` | codebase_replace protège les secrets du projet ne lit ni ne réécrit secrets.json, tout en modifiant un fichier ordinaire | `Error: spawn node_modules/@vscode/ripgrep/bin/rg ENOENT` |
| `tests/security/secret-files-guard.test.ts` | search (ripgrep) sur un projet qui contient des secrets ne renvoie aucune ligne d'un fichier secret | `AssertionError: expected false to be true // Object.is equality` |
| `tests/security/secret-files-guard.test.ts` | search (ripgrep) sur un projet qui contient des secrets trouve toujours le fichier ordinaire | `AssertionError: expected false to be true // Object.is equality` |
| `tests/security/secret-files-guard.test.ts` | search (ripgrep) sur un projet qui contient des secrets ne recherche pas une clé PEM rangée dans le workspace | `AssertionError: expected false to be true // Object.is equality` |
| `tests/security/secret-files-guard.test.ts` | search (ripgrep) sur un projet qui contient des secrets retrouve .env.example sans exposer .env | `AssertionError: expected false to be true // Object.is equality` |
| `tests/security/secret-files-guard.test.ts` | peer.tool.invoke avec une racine exposée = HOME search sur le dossier ne renvoie aucune ligne de key.pem | `AssertionError: expected false to be true // Object.is equality` |
| `tests/workspace/workspace-search.test.ts` | workspace_search searches two real git repositories and prefixes both results | `AssertionError: expected false to be true // Object.is equality` |
| `tests/workspace/workspace-search.test.ts` | workspace_search filters by repository name | `AssertionError: expected false to be true // Object.is equality` |
| `tests/workspace/workspace-search.test.ts` | workspace_search enforces the aggregated max_results bound | `AssertionError: expected false to be true // Object.is equality` |
| `tests/bash-tool.test.ts` | BashTool Safe Commands should allow grep command | `AssertionError: expected false to be true // Object.is equality` |
| `tests/unit/codebase-replace.test.ts` | Codebase Replace Tool should support regex patterns | `Error: spawn node_modules/@vscode/ripgrep/bin/rg ENOENT` |
| `tests/unit/codebase-replace.test.ts` | Codebase Replace Tool should respect glob filter | `Error: spawn node_modules/@vscode/ripgrep/bin/rg ENOENT` |
| `tests/unit/codebase-replace.test.ts` | Codebase Replace Tool should enforce maxFiles safety limit | `AssertionError: expected 'spawn <tmp>/-home-user-code-b…' to match /Too many files/` |
| `tests/unit/codebase-replace.test.ts` | Codebase Replace Tool should return zero changes when no matches found | `Error: spawn node_modules/@vscode/ripgrep/bin/rg ENOENT` |
| `tests/tools/bash-tool.test.ts` | BashTool Helper Methods should search with grep/ripgrep | `AssertionError: expected false to be true // Object.is equality` |
| `tests/tools/search-tools-context.test.ts` | registry search workspace confinement uses each execution context cwd without a cross-session singleton race | `AssertionError: expected false to be true // Object.is equality` |
| `tests/tools/search-tools-context.test.ts` | registry search workspace confinement isolates enhanced symbol and definition caches by execution cwd | `AssertionError: expected 'No symbols found matching "SharedSymb…' to contain 'left.ts'` |
| `tests/tools/search-tools-context.test.ts` | registry search workspace confinement does not follow a workspace symlink outside its root | `AssertionError: expected false to be true // Object.is equality` |
| `tests/server/peer-tool-bridge.test.ts` | peer-tool-bridge — Phase (d).23 V1.3 happy path — search (ripgrep) finds matches across workspace | `AssertionError: expected false to be true // Object.is equality` |
| `tests/server/peer-tool-bridge.test.ts` | peer-tool-bridge — Phase (d).23 V1.3 happy path — search (ripgrep) returns success with empty output when ripgrep finds zero matches (exit 1) | `AssertionError: expected false to be true // Object.is equality` |
| `tests/tools/bash.test.ts` | BashTool Helper Methods grep should execute grep command | `AssertionError: expected false to be true // Object.is equality` |
| `tests/tools/search-tools.spec.ts` | Search Tools Real Output Test UnifiedSearchTool works for text search | `AssertionError: expected false to be true // Object.is equality` |
| `tests/tools/search-tools.spec.ts` | Search Tools Real Output Test FindSymbolsTool works | `AssertionError: expected 'No symbols found matching "UserManage…' to contain 'user.ts:2'` |
| `tests/tools/search-tools.spec.ts` | Search Tools Real Output Test FindReferencesTool works | `AssertionError: expected false to be true // Object.is equality` |
| `tests/tools/search-tools.spec.ts` | Search Tools Real Output Test FindDefinitionTool works | `AssertionError: expected 'No definition found for "UserManageme…' to contain 'user.ts:2'` |
| `tests/tools/search-tools.spec.ts` | Search Tools Real Output Test SearchMultipleTool works | `AssertionError: expected false to be true // Object.is equality` |
| `tests/unit/tools-core.test.ts` | BashTool Helper Methods grep should use ripgrep for searching | `AssertionError: expected false to be true // Object.is equality` |
| `tests/unit/tools-core.test.ts` | SearchTool search should search for text content | `AssertionError: expected false to be true // Object.is equality` |
| `tests/unit/tools-core.test.ts` | SearchTool search should search both text and files | `AssertionError: expected false to be true // Object.is equality` |
| `tests/unit/tools-core.test.ts` | SearchTool search should handle case insensitive search | `AssertionError: expected false to be true // Object.is equality` |
| `tests/unit/tools-core.test.ts` | SearchTool search should handle whole word search | `AssertionError: expected false to be true // Object.is equality` |
| `tests/unit/tools-core.test.ts` | SearchTool search should handle regex search | `AssertionError: expected false to be true // Object.is equality` |
| `tests/unit/tools-core.test.ts` | SearchTool search should respect maxResults option | `AssertionError: expected false to be true // Object.is equality` |
| `tests/unit/tools-core.test.ts` | SearchTool search should filter by file types | `AssertionError: expected false to be true // Object.is equality` |
| `tests/unit/tools-core.test.ts` | SearchTool search should exclude patterns | `AssertionError: expected false to be true // Object.is equality` |
| `tests/unit/tools-core.test.ts` | SearchTool search should return no results message when nothing found | `AssertionError: expected false to be true // Object.is equality` |
| `tests/unit/tools-core.test.ts` | Tools Integration should create file and search its content | `AssertionError: expected false to be true // Object.is equality` |

#### B. Proxy HTTP du conteneur — 19 test(s)

| Fichier | Test | Message d’assertion exact (1re ligne) |
|---|---|---|
| `tests/cli/headless-exit-code.test.ts` | headless CLI exit codes emits pipeable JSON with the final text at .result | `AssertionError: expected 1 to be +0 // Object.is equality` |
| `tests/cli/headless-exit-code.test.ts` | headless CLI exit codes keeps --quiet headless stderr clean without requiring LOG_LEVEL in the parent env | `AssertionError: expected 1 to be +0 // Object.is equality` |
| `tests/cli/headless-exit-code.test.ts` | headless CLI exit codes does not dirty a real Git workspace during ephemeral headless startup | `AssertionError: expected 1 to be +0 // Object.is equality` |
| `tests/cli/headless-exit-code.test.ts` | headless CLI exit codes persists a session, run, and timeline for non-ephemeral headless turns | `AssertionError: expected 1 to be +0 // Object.is equality` |
| `tests/cli/headless-exit-code.test.ts` | headless CLI exit codes attaches an automatic table widget to headless JSON at the 200-char gate | `AssertionError: expected 1 to be +0 // Object.is equality` |
| `tests/cli/headless-exit-code.test.ts` | headless CLI exit codes returns non-zero when the provider failure is rendered as an assistant error | `AssertionError: expected 'Sorry, I encountered an error: CodeBu…' to contain 'qa forced provider failure'` |
| `tests/cli/headless-exit-code.test.ts` | headless CLI exit codes returns a dedicated non-zero code when a known tool call is only prose | `AssertionError: expected 1 to be 3 // Object.is equality` |
| `tests/cli/gk29-headless-resume.test.ts` | GK29 headless resume keeps one timeline session appends three --resume turns onto a single session and timeline | `AssertionError: expected 1 to be +0 // Object.is equality` |
| `tests/cli/middleware-resume-project.test.ts` | --resume / --continue depuis un autre projet le premier tour dans B s'arrête sur les 3 tours de B | `AssertionError: expected +0 to be 3 // Object.is equality` |
| `tests/cli/middleware-resume-project.test.ts` | --resume / --continue depuis un autre projet --resume depuis A garde les 3 tours de B, pas les 8 de A | `AssertionError: expected +0 to be 3 // Object.is equality` |
| `tests/cli/middleware-resume-project.test.ts` | --resume / --continue depuis un autre projet --continue depuis A garde les 3 tours de B, pas les 8 de A | `AssertionError: expected +0 to be 3 // Object.is equality` |
| `tests/cli/middleware-resume-project.test.ts` | --resume / --continue depuis un autre projet --max-tool-rounds reste prioritaire sur le fichier de B | `AssertionError: expected +0 to be 2 // Object.is equality` |
| `tests/cli/middleware-resume-project.test.ts` | --continue depuis un autre projet : stratégie du projet de la session la stratégie active de C (2 tours) s'applique, pas les 8 tours du fichier de A | `AssertionError: expected +0 to be 2 // Object.is equality` |
| `tests/cli/headless-empty-response.test.ts` | headless empty final response exits non-zero with a stderr diagnostic when the model returns no visible text | `AssertionError: expected 'Sorry, I encountered an error: CodeBu…' to be '' // Object.is equality` |
| `tests/cli/headless-output-flags.test.ts` | headless output file and schema flags writes the last assistant message exactly with -o | `AssertionError: expected 1 to be +0 // Object.is equality` |
| `tests/cli/headless-output-flags.test.ts` | headless output file and schema flags creates missing parent directories for -o | `AssertionError: expected 1 to be +0 // Object.is equality` |
| `tests/cli/headless-output-flags.test.ts` | headless output file and schema flags accepts a conforming final JSON response with --output-schema | `AssertionError: expected 1 to be +0 // Object.is equality` |
| `tests/cli/headless-output-flags.test.ts` | headless output file and schema flags rejects a final JSON response that does not conform to the schema | `AssertionError: expected '[2026-10-10T22:03:57.961Z]  ERROR Age…' to contain 'missing required property "answer"'` |
| `tests/cli/headless-output-flags.test.ts` | headless output file and schema flags fails with code 1 for an invalid schema file | `AssertionError: expected '[2026-10-10T22:04:18.607Z]  ERROR Age…' to contain 'Failed to load or parse schema'` |

#### C. Exécution en root (droits chmod sans effet) — 10 test(s)

| Fichier | Test | Message d’assertion exact (1re ligne) |
|---|---|---|
| `tests/commands/channel-ai-handler.test.ts` | registerAIMessageHandler inbound roundtrip (GAP-7) reprise — carte locale archivée avant la remise à zéro P5 un échec du vidage compagnon n efface pas les autres magasins | `AssertionError: P5 autres magasins effacés: expected true to be false // Object.is equality` |
| `tests/channels/messaging-session-reset.test.ts` | remise à zéro des sessions de messagerie P5 un vidage compagnon non écrit ne réussit pas et l ancien texte revient | `AssertionError: P5 vidage compagnon échoué non signalé: expected false to be true // Object.is equality` |
| `tests/channels/messaging-session-reset.test.ts` | remise à zéro des sessions de messagerie P7 le vidage compagnon ne remplace pas un fichier illisible | `AssertionError: P7 vidage illisible accepte: expected true to be false // Object.is equality` |
| `tests/backup/gk16-backup.test.ts` | GK16 backup I/O failures must not crash or pretend to have read the archive does not report a restore write failure as a read failure | `AssertionError: expected undefined to be 1 // Object.is equality` |
| `tests/memory/memory-forgetting.test.ts` | persistent memory — applyForgetting (recoverable) fail-closed: chmod 0444 on the archive file deletes nothing | `AssertionError: expected [ { key: 'precious', …(4) } ] to deeply equal []` |
| `tests/security/skill-scanner.test.ts` | scanFile refuses an unreadable regular file instead of reporting zero findings | `AssertionError: scanFile a annoncé zéro finding pour un fichier illisible: expected [] to include 'Refused to read a file; the scan did …'` |
| `tests/security/consolidated-audit-reprise.test.ts` | security audit scope and profile option fails when the profile directory cannot be read | `AssertionError: expected true to be false // Object.is equality` |
| `tests/security/consolidated-audit-reprise.test.ts` | security audit --fix stays inside the scope and only removes bits does not add owner write or fall back to the project when a 0502 directory cannot store its backup | `AssertionError: expected 320 to be 322 // Object.is equality` |
| `tests/security/consolidated-audit-reprise.test.ts` | security audit critical suppressions and incomplete checks fails when a configuration file cannot be read | `AssertionError: expected true to be false // Object.is equality` |
| `tests/security/consolidated-audit-reprise.test.ts` | security audit refuses special files without blocking does not write the fix backup into the project when the profile is not writable | `AssertionError: fix fell back to the project and reported passed: expected true to be false // Object.is equality` |

#### D. Clone placé sous /tmp — 8 test(s)

| Fichier | Test | Message d’assertion exact (1re ligne) |
|---|---|---|
| `tests/security/secret-files-guard.test.ts` | WorkspaceIsolation — la liste de refus passe avant la liste blanche la liste blanche système est en lecture seule : écrire dans ~/.codebuddy est refusé, /tmp reste inscriptible | `AssertionError: expected true to be false // Object.is equality` |
| `tests/unit/workspace-isolation.test.ts` | WorkspaceIsolation Configuration should scope an embedded actor workspace to its async turn | `AssertionError: expected true to be false // Object.is equality` |
| `tests/unit/workspace-isolation.test.ts` | WorkspaceIsolation Configuration should reject a symlink escape below a scoped workspace | `AssertionError: expected true to be false // Object.is equality` |
| `tests/unit/workspace-isolation.test.ts` | WorkspaceIsolation Configuration should reject creating a missing file through a symlinked parent | `AssertionError: expected true to be false // Object.is equality` |
| `tests/unit/workspace-isolation.test.ts` | WorkspaceIsolation Configuration should keep the global bot workspace blocked while a voice turn is active | `AssertionError: expected true to be false // Object.is equality` |
| `tests/commands/remind-cli.test.ts` | GK23 E3 — buddy remind CLI usage unknown action lists agenda among the subcommands | `AssertionError: expected '' to match /agenda/` |
| `tests/commands/remind-cli.test.ts` | GK23 E3 — buddy remind CLI usage add without --at mentions --date | `AssertionError: expected '' to match /--date/` |
| `tests/commands/remind-cli.test.ts` | GK23 — buddy remind add/list/agenda/rm (real CLI) adds a dated one-shot and a recurring reminder, lists them, shows agenda, then removes | `AssertionError: expected 1 to be +0 // Object.is equality` |

#### E. Ni démon Docker ni bwrap — 9 test(s)

| Fichier | Test | Message d’assertion exact (1re ligne) |
|---|---|---|
| `tests/tools/bash-imported-skill-guard.test.ts` | scripts de skills importés : inertes, lancement soumis à confirmation (chemin bash réel) script sur la liste blanche (empreinte du fichier courant) : pas de confirmation | `AssertionError: refused by test: expected false to be true // Object.is equality` |
| `tests/tools/bash-imported-skill-guard.test.ts` | scripts de skills importés : inertes, lancement soumis à confirmation (chemin bash réel) les autres usages de bash ne sont pas touchés | `AssertionError: refused by test: expected false to be true // Object.is equality` |
| `tests/tools/bash-imported-skill-guard.test.ts` | reprise 15 : lecture puis lancement, make nu, chemin assemblé (bash réel) cat/head/tee/grep d'un SCRIPT puis lancement de la copie | `AssertionError: refused by test: expected false to be true // Object.is equality` |
| `tests/tools/bash-imported-skill-guard.test.ts` | reprise 15 : lecture puis lancement, make nu, chemin assemblé (bash réel) pas de faux positif : variables, find sans -exec, xargs/make hors du skill, skill sans script | `AssertionError: expected false to be true // Object.is equality` |
| `tests/tools/bash-imported-skill-guard.test.ts` | reprise 15 : lecture puis lancement, make nu, chemin assemblé (bash réel) skill sans script : aucune règle ne se déclenche | `AssertionError: refused by test: expected false to be true // Object.is equality` |
| `tests/tools/bash-imported-skill-guard.test.ts` | reprise 15 : lecture puis lancement, make nu, chemin assemblé (bash réel) tous les scripts autorisés : find -exec sur le dossier ne demande plus | `AssertionError: refused by test: expected false to be true // Object.is equality` |
| `tests/tools/bash-imported-skill-guard.test.ts` | reprise 17 : vrai analyseur shell, enveloppes, glob, execute_code glob et accolades du fichier d'origine | `AssertionError: refused by test: expected false to be true // Object.is equality` |
| `tests/tools/bash-imported-skill-guard.test.ts` | reprise 18 : récursion -c/eval, listes for, classes POSIX, enveloppes à arguments pas de faux positif ajouté : -c sans skill visé, for sans skill, wrappers ordinaires | `AssertionError: bash -c "echo hello": refused by test: expected false to be true // Object.is equality` |
| `tests/tools/bash-imported-skill-guard.test.ts` | reprise 19 : here-documents, here-strings, entrée redirigée, tubes pas de faux positif : documents en here-doc, cat <<EOF, tubes ordinaires | `AssertionError: cat <<EOF` |

#### F. Vitest en mode « agent IA » — 1 test(s)

| Fichier | Test | Message d’assertion exact (1re ligne) |
|---|---|---|
| `tests/hygiene/home-isolation.test.ts` | dossier temporaire atteint par un lien (comme le TEMP 8.3 des runners Windows) les XDG_* restent sous os.homedir() quand TMPDIR/TEMP passe par un lien | `AssertionError: expected '\n RUN  v4.1.11 <tmp>…' to contain 'XDG_SOUS_HOME'` |

## 3. Dépendances circulaires

`npm run check:circular` : `✗ Found 17 circular dependencies` (code 1).

Comparaison avec `origin/main` (`aa328839c`, même outillage) : **16 cycles déjà présents sur `main`**, donc le contrôle est rouge avant cette branche. **La branche en ajoute un seul :**

```
codebuddy/client.ts → codebuddy/provider-handoff.ts → services/prompt-builder.ts → memory/index.ts
  → memory/cross-modal-search.ts → memory/persistent-memory.ts → memory/facts-memory.ts
  → providers/auxiliary-llm.ts → codebuddy/client.ts
```

- **Origine.** Le nouveau fichier `src/providers/auxiliary-llm.ts` (+306 lignes, commit `064ff3a9c` « garder les appels auxiliaires sur le fournisseur de la session ») importe la **valeur** `CodeBuddyClient` depuis `../codebuddy/client.js`. Il est importé par `memory/facts-memory.ts`. Le script ignore les imports de type (`skipTypeImports: true`), il s'agit donc d'un vrai cycle d'exécution.
- **Portée.** Ce contrôle ne figure ni dans `.github/workflows/` ni dans `npm run validate`. Il **ne bloque pas** la fusion, mais un cycle d'import de valeur en ESM peut produire des erreurs d'initialisation selon l'ordre de chargement.
- **Correctif possible, non appliqué (consigne).** Importer `CodeBuddyClient` paresseusement (`await import`) dans `auxiliary-llm.ts`. Sinon, l'ajouter explicitement à `KNOWN_CYCLES` avec une justification.

## Ce que je ne peux pas savoir

- **Le résultat sur un runner standard** (non root, Docker présent, sans proxy, clone hors `/tmp`, hors agent IA). Chaque cause a été neutralisée séparément, mais **pas toutes en même temps dans un seul passage complet**. Une interaction entre causes n'est pas exclue.
- **La catégorie C (root) n'a pas été rejouée sans root** : la création d'un utilisateur a été refusée par la politique de la session. Le classement repose sur la lecture du code des tests et sur la démonstration que root écrit malgré `0444`.
- **La cause exacte des 3 échecs `remind-cli`** : ils réussissent depuis la copie hors `/tmp`, sans que le mécanisme ait été isolé.
- **Les fonctions qui dépendent de `onnxruntime-node`**, absent ici : aucun test ne l'a signalé, mais son absence peut masquer des tests ignorés en silence.
- **macOS et Windows** : non testés.
- **La CI GitHub de la branche** : aucune exécution n'existe pour `release/v2.3.0-2026-10-08` (pas de PR), donc pas de comparaison possible.
- **Les 83 tests ignorés** n'ont pas été examinés un par un.
