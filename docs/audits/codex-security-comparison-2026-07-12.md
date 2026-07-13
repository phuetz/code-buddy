# Audit comparatif sécurité : Code Buddy et Codex

Date : 12 juillet 2026
Référence Codex : commit [`9e552e9d15ba52bed7077d5357f3e18e330f8f38`](https://github.com/openai/codex/commit/9e552e9d15ba52bed7077d5357f3e18e330f8f38), consulté le 12 juillet 2026.

## Conclusion

L'assouplissement retenu ne consiste pas à supprimer les contrôles. Code Buddy passe d'interdictions fondées surtout sur le nom du binaire à une décision fondée sur **l'action complète**, son périmètre et son mode d'exécution :

- une opération locale et réversible s'exécute sans interruption dans un sandbox limité au workspace ;
- un franchissement de frontière demande une autorisation précise ;
- une action catastrophique reste refusée avant exécution.

Cette approche rapproche Code Buddy de la séparation Codex entre **politique d'approbation**, **permissions du sandbox** et **escalade bornée**, tout en conservant des garde-fous statiques pour les destructions de machine.

## Écarts constatés avant l'audit

1. Les validations, confirmations, règles déclaratives et sandboxes formaient plusieurs chemins concurrents. Le chemin Bash principal et le streaming ne prenaient pas toujours la même décision.
2. Une commande pouvait être déclarée sûre d'après son premier binaire : `find . -delete`, `echo x > fichier` ou une chaîne composée échappaient ainsi à une analyse complète.
3. Des familles utiles (`rm`, `chmod`, `systemctl`, `chown`) étaient bloquées en bloc. Code Buddy perdait des capacités même quand l'effet était local ou explicitement autorisable.
4. « Ne plus demander » et certains modes Cowork/voix reposaient sur un état global. Une session pouvait élargir ou réduire les droits d'une autre session concurrente.
5. Le sandbox natif existait, mais n'était pas la frontière d'exécution commune. Une indisponibilité pouvait conduire à un repli direct et silencieux.
6. Les métadonnées sensibles du workspace n'étaient pas toutes recouvertes en lecture seule après le montage inscriptible du parent.

## Architecture mise en œuvre

Le nouveau chemin d'exécution est le suivant :

```text
garde catastrophique
        ↓
analyse de toute l'expression shell
        ├── deny → refus
        ├── ask → autorisation exacte → exécution hôte
        └── allow / sandbox → sandbox workspace
                                  └── refus de frontière → autorisation exacte
```

### 1. Classification par effet

[`execpolicy.ts`](../../src/sandbox/execpolicy.ts) analyse chaque segment de l'expression shell, applique les règles argv/préfixe et agrège selon `deny > ask > sandbox > allow`. Les commandes inconnues vont par défaut dans le sandbox, les redirections et syntaxes complexes ne peuvent plus hériter d'un `allow`, et les variantes dangereuses de `find`, `rg` ou `git` sont distinguées de leurs usages en lecture.

[`safe-binaries.ts`](../../src/security/safe-binaries.ts) applique la même prudence au mode plan : toute la chaîne doit être en lecture seule, avec contrôle des options. [`command-validator.ts`](../../src/tools/bash/command-validator.ts) conserve une petite barrière indépendante pour les opérations intrinsèquement destructrices de la machine (`mkfs`, `wipefs`, redémarrage, gestion des comptes, etc.), au lieu de bloquer toute mutation utile.

Les règles déclaratives utilisent maintenant le parseur Shell et donnent priorité au refus dans [`declarative-rules.ts`](../../src/security/declarative-rules.ts). Le raccourci historique `shell:safe` ne valide plus une action à risque élevé dans [`policy-engine.ts`](../../src/security/policy-engine.ts).

### 2. Une frontière d'exécution commune

[`execution-policy.ts`](../../src/tools/bash/execution-policy.ts) relie la politique à l'exécution réelle. Il est appelé par le chemin normal dans [`bash-tool.ts`](../../src/tools/bash/bash-tool.ts) et par le chemin streaming dans [`streaming-executor.ts`](../../src/tools/bash/streaming-executor.ts).

Une décision `sandbox` utilise le profil `workspace-write` de [`os-sandbox.ts`](../../src/sandbox/os-sandbox.ts) : réseau désactivé, workspace seul en écriture, métadonnées sensibles recouvertes en lecture seule et repli direct désactivé. Une décision `allow` supprime la demande d'autorisation, mais conserve elle aussi ce confinement. Bubblewrap est testé par une vraie création de namespace ; [`docker-sandbox.ts`](../../src/sandbox/docker-sandbox.ts) sert de solution de repli isolée et exécute avec l'UID/GID de l'utilisateur.

Le fallback Docker est renforcé par une racine en lecture seule, la suppression des capabilities, `no-new-privileges`, une limite de processus et un `/tmp` éphémère. L'image dédiée définie dans [`workspace-sandbox.Dockerfile`](../../docker/workspace-sandbox.Dockerfile) fournit Git, ripgrep, Node, Python et les outils de compilation usuels sans exposer le réseau. Elle est sélectionnée automatiquement quand elle est construite localement ; l'image Node minimale reste le fallback portable.

```bash
npm run sandbox:build
```

Si aucun sandbox ne fonctionne, Code Buddy n'exécute pas implicitement la commande sur l'hôte : il demande une escalade visible et précise.

### 3. Approbations précises et isolées par session

[`confirmation-service.ts`](../../src/utils/confirmation-service.ts) mémorise les nouvelles autorisations Bash avec une clé exacte dérivée du répertoire canonique, de la commande normalisée, de tous ses segments analysés, du profil de sandbox et de l'environnement filtré. Le contexte d'approbation est isolé par `AsyncLocalStorage` : la même commande dans un autre workspace ou une autre session redemande l'accord.

Les modes temporaires suivent également le tour asynchrone dans [`permission-modes.ts`](../../src/security/permission-modes.ts). L'adaptateur Cowork applique ensemble contexte d'approbation, mode de permission et mode opératoire dans [`codebuddy-engine-adapter.ts`](../../src/desktop/codebuddy-engine-adapter.ts).

Lisa ne reprend plus le mode plan d'un onglet de code : le tour vocal Cowork envoie un override `default` dans [`VoiceChatOverlay.tsx`](../../cowork/src/renderer/components/VoiceChatOverlay.tsx), et l'assistant résident utilise le même isolement dans [`agent-reply.ts`](../../src/sensory/agent-reply.ts) et [`voice-loop.ts`](../../src/sensory/voice-loop.ts). Un mode plan explicitement choisi reste, lui, strictement en lecture seule.

## Boucle comparative autonome no 2

Une seconde lecture du Codex au même commit, suivie de trois passes « mesurer → corriger → réauditer », a trouvé des écarts au-delà de Bash :

- 184 des 233 adaptateurs interactifs n'avaient aucun groupe de politique ;
- une décision `confirm` continuait silencieusement lorsque le callback optionnel n'était pas installé ;
- une confirmation réussie promouvait ensuite le seul nom de l'outil en autorisation globale de session, sans tenir compte des arguments ni du projet ;
- les hooks pouvaient modifier les arguments après les contrôles ;
- `apply_patch` acceptait `../`, les chemins absolus et les parents symlinkés dans son chemin par défaut ;
- RTK réécrivait une commande après son approbation et le self-healing lançait sa correction directement sur l'hôte ;
- les sondes Docker répétées ajoutaient environ 50 ms à chaque commande confinée.

### 4. Porte d'action commune et portée exacte

[`tool-handler.ts`](../../src/agent/tool-handler.ts) ne laisse plus passer `confirm` : à défaut d'un callback embarqué, il utilise la même [`ConfirmationService`](../../src/utils/confirmation-service.ts) que le terminal et Cowork. La clé créée par [`approval-scope.ts`](../../src/security/tool-policy/approval-scope.ts) lie le nom, tous les arguments canoniques et le répertoire réel, sans exposer les secrets dans le dialogue. La promotion historique `toolName → allow` a été retirée.

Les refus déterministes (permission, politique, dossier de confiance, WritePolicy) précèdent le dialogue. Si un hook modifie un argument, l'action finale repasse intégralement par ces contrôles et reçoit une autre clé. Les flux streaming spéciaux `reason` et `generate_document` utilisent eux aussi ce préflight.

[`tool-groups.ts`](../../src/security/tool-policy/tool-groups.ts) fait maintenant hériter les 30 alias du vrai outil et introduit `group:safe` pour les capacités explicitement auditées `fleetSafe`. Ainsi `weather`, `stock_quote` et `project_map` redeviennent utilisables en REST/batch, tandis que `browser_click` ou `generate_document` restent à confirmer. [`tool-aliases.ts`](../../src/tools/registry/tool-aliases.ts) transmet enfin `cwd`, `sessionId`, `botId`, dry-run et signal d'annulation à l'implémentation réelle.

### 5. Confinement intrinsèque des patches

[`apply-patch.ts`](../../src/tools/apply-patch.ts) prévalide maintenant **toutes** les sources et destinations avant la première écriture. La racine du workspace est canonicalisée, le parent existant le plus proche est résolu, la whitelist système est désactivée pour cette surface d'écriture et un seul chemin invalide annule le patch entier. Cette protection vit dans l'outil lui-même : elle couvre donc ToolHandler mais aussi les appels directs depuis cloud, workflow ou multi-agent.

### 6. Plan Shell figé avant autorisation

RTK est désormais appliqué avant l'analyse, le sandbox et le dialogue, dans les chemins buffered et streaming. Si le texte change, le dialogue montre la commande originale et la commande transformée. Une correction proposée par le self-healing rappelle le pipeline complet avec la récursion de réparation désactivée : elle ne peut plus atteindre `spawn` directement.

La clé Shell contient maintenant l'identité des exécutables résolus avec le `PATH` réellement filtré : `realpath`, périphérique, inode, taille, date de modification et mode, en plus de l'identité de Bash. Ces signatures sont revérifiées juste avant toute exécution directe. Cela ne remplace pas l'interception `execve` de Codex, mais empêche une approbation de survivre au remplacement courant d'un binaire ou d'un symlink. Les codes applicatifs `2`, `126` et `127` ne sont plus interprétés comme une preuve de refus du sandbox.

### 7. Latence Docker mesurée

[`docker-sandbox.ts`](../../src/sandbox/docker-sandbox.ts) met en cache uniquement les sondes Docker positives pendant 30 secondes, par contexte Docker, avec single-flight et invalidation immédiate sur erreur ou exit `125`. Le cache image est borné à 32 entrées. Sur cette machine, la moyenne chaude réelle de `executeInWorkspaceSandbox('true')` est passée de **353,5 ms à 300,7 ms**, soit environ **53 ms / 15 %** gagnés sans changer la frontière d'isolation. Le démarrage du conteneur (~297 ms) reste le poste dominant ; un pool one-shot précréé pourrait aller plus loin, mais n'a volontairement pas été activé dans cette boucle.

## Matrice avant/après

| Cas                                                   | Avant                                                | Maintenant                                                |
| ----------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------- |
| `git status`, `rg TODO src` en plan                   | Bash souvent refusé ou classé d'après le premier mot | chaîne complète validée, lecture confinée                 |
| `echo x > note.txt`                                   | pouvait hériter du statut sûr de `echo`              | écriture confinée au workspace                            |
| `find . -delete`                                      | pouvait être considéré comme une lecture             | mutation confinée au workspace                            |
| `rm -rf dist`, `chmod +x script.sh`                   | binaire bloqué en bloc                               | opération locale exécutée dans le sandbox                 |
| `npm test`, build ou lint                             | traitement large du gestionnaire de paquets          | routine de développement confinée, réseau coupé           |
| `npm install`, `git push`                             | demande large ou comportement variable               | approbation exacte avant franchissement de frontière      |
| `systemctl --user restart lisa.service`               | `systemctl` entièrement bloqué                       | autorisation explicite pour cette commande et ce cwd      |
| `rm -rf /`, `mkfs`, redémarrage machine               | refus                                                | refus conservé avant sandbox                              |
| `git status && rm -rf dist`                           | le premier segment pouvait masquer le second         | tous les segments analysés, décision la plus stricte      |
| « Ne plus demander » pour Bash                        | drapeau pouvant couvrir toutes les commandes         | clé exacte, isolée par session sur le nouveau chemin Bash |
| Sandbox indisponible                                  | repli direct possible selon le chemin                | aucun repli silencieux ; escalade explicite               |
| Lisa/Cowork pendant un onglet en plan                 | état global ou plan hérité                           | posture `default` limitée au tour vocal ; onglet inchangé |
| `.git` et `.codebuddy` dans un workspace inscriptible | protection contournable par l'ordre des montages     | overlay en lecture seule appliqué après le montage parent |
| outil classé `confirm`, sans callback                  | exécution silencieuse                                | refus ou dialogue réel ; aucun fallthrough                 |
| autoriser un appel `browser_click`/MCP                 | autorisait ensuite tout le nom d'outil               | portée exacte outil + arguments + cwd                      |
| hook modifiant `path` après le contrôle                | nouveaux arguments exécutés sans réévaluation        | tous les contrôles sont rejoués sur l'action finale        |
| alias `file_write`/`shell_exec` dans Cowork            | groupes et contexte `cwd` perdus                     | groupes hérités et contexte transmis                       |
| `apply_patch` vers `../x` ou un parent symlinké        | écriture possible hors workspace en mode par défaut  | préflight canonique atomique, patch refusé                 |
| commande réécrite par RTK                              | approbation de l'original, exécution du transformé   | transformé figé puis analysé, affiché et approuvé           |
| commande de réparation automatique                    | `spawn` hôte direct                                  | pipeline complet, sans réparation récursive                |
| binaire remplacé après approbation                     | clé inchangée                                        | signature différente, exécution directe refusée            |
| code sandbox `127`                                     | escalade hôte proposée                               | échec applicatif rendu, aucune escalade implicite           |
| sondes Docker à chaque commande                        | ~53 ms de sondes répétées                            | cache positif single-flight avec invalidation               |

Les régressions principales sont couvertes dans [`execpolicy.test.ts`](../../tests/sandbox/execpolicy.test.ts), [`bash-execution-policy.test.ts`](../../tests/tools/bash-execution-policy.test.ts), [`safe-binaries.test.ts`](../../tests/security/safe-binaries.test.ts), [`declarative-rules.test.ts`](../../tests/security/declarative-rules.test.ts), [`permission-modes.test.ts`](../../tests/security/permission-modes.test.ts), [`confirmation-service.test.ts`](../../tests/utils/confirmation-service.test.ts), [`tool-handler-confirmation-gate.test.ts`](../../tests/agent/tool-handler-confirmation-gate.test.ts), [`apply-patch-registration.test.ts`](../../tests/tools/apply-patch-registration.test.ts), [`approval-scope.test.ts`](../../tests/security/tool-policy/approval-scope.test.ts), [`docker-probe-cache.test.ts`](../../tests/sandbox/docker-probe-cache.test.ts) et [`bash-tool.test.ts`](../../tests/unit/bash-tool.test.ts).

## Limites restantes

1. **Pas d'interception `execve`.** Code Buddy résout et revalide les exécutables juste avant `spawn`, mais une course minuscule reste possible entre le dernier `stat` et l'exec réel. La parité complète demanderait un broker Rust/Unix comparable à celui de Codex.
2. **Orchestrateur pas encore universel.** ToolHandler est maintenant cohérent et `apply_patch` est sûr intrinsèquement, mais plusieurs workflows, plugins, MCP et chemins multi-agent appellent encore `FormalToolRegistry.execute()` directement. Il faut déplacer un contrat d'effet commun au registre sans doubler les dialogues des outils déjà protégés.
3. **Scopes CLI/serveur incomplets.** Cowork et les acteurs voix ont un contexte asynchrone isolé ; le fallback historique `global` existe encore pour certains appelants CLI/serveur. Il manque un objet `{ sessionId, turnId, environmentId }` avec stores distincts tour/session et aucune mémorisation anonyme.
4. **Annotations MCP perdues.** Le client ne conserve pas encore `readOnlyHint`, `destructiveHint`, `idempotentHint` et `openWorldHint`. PubCommander ou un autre serveur MCP ne peut donc pas distinguer automatiquement une prévisualisation d'une publication/suppression.
5. **Règles provider/agent injoignables.** `PolicyResolver` sait les appliquer, mais `PolicyManager.checkTool()` n'injecte pas encore les contextes provider/agent au runtime.
6. **Coût du fallback Docker.** Le cache retire les sondes répétées, mais un conteneur one-shot chaud coûte encore environ 300 ms. L'image dédiée est locale et n'est pas encore publiée ni préparée automatiquement par `buddy doctor`.
7. **Profils OS encore peu composables.** Les modes sont codés en dur. Il manque des profils nommés et héritables séparant racines de lecture/écriture, réseau et permissions additionnelles, avec parité Seatbelt/Docker/Windows.
8. **Analyse Shell conservatrice, pas formelle.** Les substitutions et syntaxes ambiguës vont au sandbox, mais le parseur n'est pas une sémantique Bash exhaustive. Les règles intégrées restent réparties entre policy, validateur et profils au lieu d'un format versionné unique.

## Validation de la seconde boucle

- `npm run typecheck` et `npm run build` : réussis ;
- `npm run lint` : réussi sans erreur ;
- suite ciblée sécurité/sandbox/Bash/action-gate/patch : **1 334 tests réussis**, 1 test natif ignoré ;
- tests ciblés Docker cache : 30 réussis ;
- fumée Docker réelle répétée : backend `docker`, moyenne chaude **300,7 ms** après cache contre **353,5 ms** avant.

## Références officielles Codex au commit audité

- Séparation orchestration, approbation et tentative sandboxée : [`core/src/tools/orchestrator.rs`](https://github.com/openai/codex/blob/9e552e9d15ba52bed7077d5357f3e18e330f8f38/codex-rs/core/src/tools/orchestrator.rs).
- Demandes de permissions additionnelles bornées au tour ou à la session : [`protocol/src/request_permissions.rs`](https://github.com/openai/codex/blob/9e552e9d15ba52bed7077d5357f3e18e330f8f38/codex-rs/protocol/src/request_permissions.rs).
- Modèle de permissions et métadonnées protégées : [`protocol/src/permissions.rs`](https://github.com/openai/codex/blob/9e552e9d15ba52bed7077d5357f3e18e330f8f38/codex-rs/protocol/src/permissions.rs).
- Règles argv par préfixe : [`execpolicy/README.md`](https://github.com/openai/codex/blob/9e552e9d15ba52bed7077d5357f3e18e330f8f38/codex-rs/execpolicy/README.md).
- Résolution bornée des exécutables hôte : [`execpolicy/src/policy.rs`](https://github.com/openai/codex/blob/9e552e9d15ba52bed7077d5357f3e18e330f8f38/codex-rs/execpolicy/src/policy.rs).
- Détection conservatrice des refus sandbox (exclusion 2/126/127) : [`sandboxing/src/denial.rs`](https://github.com/openai/codex/blob/9e552e9d15ba52bed7077d5357f3e18e330f8f38/codex-rs/sandboxing/src/denial.rs).
- Profils de permissions nommés et héritables : [`config/src/permissions_toml.rs`](https://github.com/openai/codex/blob/9e552e9d15ba52bed7077d5357f3e18e330f8f38/codex-rs/config/src/permissions_toml.rs).
- Préréglages distinguant approbation et sandbox : [`utils/approval-presets/src/lib.rs`](https://github.com/openai/codex/blob/9e552e9d15ba52bed7077d5357f3e18e330f8f38/codex-rs/utils/approval-presets/src/lib.rs).
- Portée exacte d'une approbation Shell : [`core/src/tools/runtimes/shell.rs`](https://github.com/openai/codex/blob/9e552e9d15ba52bed7077d5357f3e18e330f8f38/codex-rs/core/src/tools/runtimes/shell.rs).
- Principe officiel « sandbox technique + politique d'approbation » : [Running Codex safely at OpenAI](https://openai.com/index/running-codex-safely/).

## Décision

La direction reste : **assouplir les décisions, renforcer la frontière d'exécution**. Cette boucle a livré le préflight commun ToolHandler, les clés exactes, la réautorisation post-hook, le confinement intrinsèque de `apply_patch`, le plan Shell figé, l'identité d'exécutable et le gain de latence Docker. La prochaine priorité n'est plus Bash : c'est un contrat d'effets au niveau du registre, puis les scopes `{tour, session, environnement}` et les annotations MCP avant de retirer les drapeaux globaux historiques.
