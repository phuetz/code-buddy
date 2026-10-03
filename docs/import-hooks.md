# Importer des hooks externes

Code Buddy lit le format `hooks` de `hooks/hooks.json` (plugin Claude Code/ECC)
et de `.claude/settings.json`. L'import utilise le pare-feu des skills et le
**UserHooksManager existant**, appelé par les sessions et les outils.

```sh
buddy hooks import --dir ./everything-claude-code          # rapport JSON, aucune écriture
buddy hooks import --file .claude/settings.json --apply   # installe DÉSACTIVÉ
buddy hooks imported
buddy hooks enable imported-pretooluse-0123456789abcdef
buddy hooks disable imported-pretooluse-0123456789abcdef
buddy hooks remove imported-pretooluse-0123456789abcdef
```

L'installation est locale au projet courant : `.codebuddy/imported-hooks/<id>`.
Le manifeste contient la source, son SHA-256, le SHA-256 du hook et les empreintes
des fichiers copiés. Les hooks natifs dans `.codebuddy/hooks.json` sont conservés.
Un import répété ne remplace ni les fichiers ni l'état d'activation.

Chaque commande et chaque dépendance copiée passe le scanner existant, sur les
octets effectivement installés. Tout verdict `review` ou `quarantine` reste
inerte dans `.codebuddy/hook-quarantine/<id>`, avec motifs. `enable` ne contourne
pas la quarantaine : il contrôle les empreintes et relance le pare-feu. Le runner relance aussi le scanner partagé sur chaque fichier et sur les octets capturés, même après activation.
Le runner vérifie encore les empreintes et l'état d'activation avant chaque
exécution, ainsi que la traduction de commande et la fermeture des dépendances.
Un JSON de configuration illisible ou invalide, un type natif inconnu/absent
ou un bundle importé altéré bloque PreToolUse avec motif.
L'import ne lance aucune commande, aucun téléchargement, aucune
installation de dépendances. Le mode rapport ne crée même pas le journal CLI.

## Traductions et limites explicites

| Source | Traitement |
|---|---|
| PreToolUse, PostToolUse, PostToolUseFailure | Événements déjà produits par la boucle d'outils |
| SessionStart / SessionEnd | Hooks existants ; première requête et fermeture `buddy -p` attendent leur fin |
| PreCompact | Frontière synchrone existante, **consultative** ; budget de commande ≤ 5 s, plus lancement du superviseur ; superviseur Linux qui tue le groupe et les descendants adoptés, même après `setsid`, au timeout ; ne bloque pas la compaction |
| Stop et autres événements | Refus avec motif ; pas de producteur utilisateur équivalent pour Stop |
| Bash / Edit / Write / Read | bash / str_replace_editor / create_file / view_file, avec leurs alias existants |
| Grep, Glob / WebFetch / WebSearch | search / web_fetch / web_search |
| Matchers | Noms exacts et alternatives `A\|B`, wildcard, préfixes MCP ; autres expressions refusées |
| PowerShell, MultiEdit, Skill | Refus : contrats non équivalents |
| `${CLAUDE_PLUGIN_ROOT}` | Racine du bundle **copié**, jamais le chemin de la machine source |
| `${CLAUDE_PROJECT_DIR}` | Répertoire d'exécution courant |
| Autres variables Claude, transcript_path | Refus ou quarantaine ; aucune fausse transcription Claude créée |
| env dans settings.json | Refus si non vide ; aucun environnement de la machine source recopié |
| timeout | Secondes → millisecondes, valeur positive ≤ 300 s |
| async, autres types/options | Refus, aucune tâche de fond importée |

Le sous-ensemble initial accepte les commandes littérales POSIX `node`, `sh`,
`bash`, `echo`, `printf`, `true`, `false`, `exit`. Les imports Node copient les
`require`/`import` locaux statiques ; seuls les modules Node `path`, `assert` et
`assert/strict` sont admis. Les capacités fichier (y compris lecture de secrets
et écriture de configuration), réseau, sous-processus et environnement ambiant
restent en quarantaine. Les accès calculés (`objet[...]`), globals dynamiques
(`globalThis`, `eval`, `Function`), réflexion, récepteurs indirects et alias de
`process` restent également en quarantaine, même sans alerte du scanner partagé.
Cette politique complémentaire s'applique à l'import, à l'activation et avant
l'exécution des anciens bundles. Elle ne modifie pas le pare-feu partagé.
Les scripts Node doivent finir en `.js`, `.cjs` ou `.mjs`, les scripts shell en
`.sh` ou `.bash` ; un interpréteur déguisé par l'extension est refusé.
Les scripts shell utilisent une grammaire littérale limitée ; leurs dépendances
doivent référencer `CLAUDE_PLUGIN_ROOT`. Les backticks, substitutions, tildes, globs, escapes et options/formats printf non prouvés littéraux restent en quarantaine. Les `package.json` avec `main`, `exports`, `imports`, `bin` ou `scripts` restent en quarantaine ; les métadonnées passives copiées sont réduites au champ `type`. Les chemins absolus de la source, liens
symboliques, traversées, fichiers spéciaux, contenus binaires et sources trop
volumineuses sont refusés. Windows est explicitement refusé pour ces commandes
POSIX. Les handlers de commande, importés ou natifs, nécessitent désormais Linux, `/usr/bin/python3`, `/proc` et `PR_SET_CHILD_SUBREAPER`. Sans ces capacités, la commande est refusée avant lancement : aucun repli SIGTERM sur Windows ou macOS. Les handlers HTTP/prompt/agent natifs restent distincts.

Le stdin JSON traduit `hook_event_name`, `tool_name`, `tool_input.file_path`,
`tool_use_id`, `session_id`, `cwd`, `tool_response` et `error`. Le résultat d'outil
reste celui de Code Buddy (`success`, `output`, `error`) ; l'identifiant de session
reste vide lorsqu'aucun n'est disponible. Le contexte n'est jamais interpolé dans
la commande importée. Les champs d'outil sont présents uniquement aux événements
d'outil. `source` (SessionStart) et `reason` (SessionEnd) sont omis en l'absence
de valeur réelle ; `trigger` concerne uniquement PreCompact et traduit la raison
réelle de la compaction. L'environnement hérité est limité aux variables du mode
`core` de ShellEnvPolicy, sans clés API ni préchargements d'interpréteur.

Le **code 2 bloque PreToolUse**, avec stderr comme feedback. Le code 77 appartient
à l'ancien HookManager et n'est pas un blocage ici. Pour les événements déjà
accomplis et les sessions, le code 2 donne un feedback sans bloquer. Sur stdout,
`hookSpecificOutput` est adapté : `permissionDecision: deny`, `updatedInput`,
`additionalContext`, `permissionDecisionReason`. Les arguments modifiés et le
contexte arrivent à la boucle réelle. Les clés de chemin (`path`, `file_path`,
`filePath`, `target_file`, `filename`) sont classifiées avant réécriture. Les
remplacements de `command` / `initial_command` sont limités à une commande
littérale `printf`, `echo`, `true`, `false` ou `exit`, avec arguments ASCII
littéraux et une longueur totale ≤ 8 192 caractères. Les interpréteurs, lecteurs de fichiers,
expansions, opérateurs, redirections, caractères de contrôle et syntaxes
inconnues sont refusés avant de modifier les arguments ou de remettre la main
à l’outil interactif. Les options printf et formats hors `%s`, `%d`, `%%` sont
refusés. Ce contrôle s’applique aux remplacements fournis par PreToolUse, y
compris les handlers natifs ; les commandes initiales suivent leur pipeline
Bash habituel. Un chemin credential visible est également refusé par le
classificateur Bash existant, qui ne peut pas analyser un chemin reconstruit
dans un interpréteur. La politique littérale ferme cette substitution sans
prétendre que le classificateur protège tout programme arbitraire.
Un échec de classification bloque PreToolUse. Une décision JSON illisible/invalide ou une terminaison par signal bloque PreToolUse. Les sorties des commandes sont bornées à 256 KiB. Les octets vérifiés d’un import sont exécutés depuis une copie privée temporaire, supprimée après arrêt des descendants ; une modification ultérieure du bundle du projet ne remplace pas les octets exécutés. Ce contrôle statique conservateur et cette supervision ne constituent pas une sandbox contre un utilisateur du système déjà compromis.
Les autres codes restent des avertissements. Un timeout, une sortie trop grande
ou un échec d'exécution d'un hook de commande bloque désormais PreToolUse ; les autres
événements restent consultatifs.
Ce sous-ensemble ne reproduit pas toutes les décisions universelles Claude.

ECC au commit `ef648e01899ba3e8dc6371642deaaf64b4477775` : 24 handlers,
**0 admissible, 9 en quarantaine, 15 refusés**. Son bootstrap charge des modules
dynamiquement ; désactiver ce garde-fou pour annoncer une compatibilité serait
incorrect. La recette a validé séparément des hooks admissibles dans un vrai
`buddy -p` avec Ollama. Voir le [rapport de mission](reports/2026-10/IMPORT-HOOKS-2026-10-03.md).
La [reprise après revue](reports/2026-10/REPRISE-IMPORT-HOOKS-2026-10-03.md)
ferme les accès dynamiques et secrets. La [seconde reprise](reports/2026-10/REPRISE-2-IMPORT-HOOKS-2026-10-03.md) traite les contre-revues shell, résolution Node, activation et processus détachés.

Références : [contrat Claude Code](https://code.claude.com/docs/en/hooks),
[sources ECC (MIT)](https://github.com/affaan-m/everything-claude-code).
