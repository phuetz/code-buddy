# Importer une bibliothèque de skills et d'agents

```bash
buddy skills import --dir /chemin/bibliotheque --agents --json
buddy skills import --dir /chemin/bibliotheque --agents --apply --json
```

Sans `--apply`, la commande ne fait qu'analyser. Si la bibliothèque possède une racine
`skills/`, elle est canonique : les copies documentaires, traductions et intégrations
situées ailleurs sont ignorées. Les copies de traduction identiques, au même chemin relatif sous un répertoire de
locale, sont dédoublonnées après scan. Un nom de catégorie ressemblant à une locale
ne suffit pas à éliminer un skill. Une racine canonique liée ou ambiguë refuse
l’import ; la casse réelle du nom du répertoire est conservée. Le rapport donne chaque chemin ignoré et sa raison. Deux skills
indépendants portant le même nom conservent chacun un nom d'import distinct.

**Scripts inertes + confirmation (reprise 14).** Une liste de motifs ne fermera jamais la classe « un script contourne l'analyse » (douze reprises, autant de contournements) ; la reprise 13 mettait donc tout script en quarantaine, au prix de skills utiles (excalidraw, arxiv, maps…). La porte reste, la sanction change :

- **Quarantaine** : binaire ou bibliothèque (ELF, PE, Mach-O, WebAssembly, `.jar`, `.so`…), **archive** (zip, gzip, tar, xz, 7z, rar, zstd, reconnues aux premiers octets même sous un nom de donnée), lien symbolique ou physique, et script que l'analyse par motifs classe dangereux (comme avant). SKILL.md reste jugé par le pare-feu d'injection.
- **Import inerte** : tout script (extensions de script y compris double extension, extension à caractères pleine chasse/cyrilliques/invisibles, `Makefile`/`*.mk`/`*.make`, shebang même après un BOM ou des blancs, bit exécutable, tout fichier sous `scripts/`, `bin/`, `hooks/`) est importé sans bit exécutable, le skill porte `scriptsUnverified: true` et la liste `scripts` (chemin installé, chemin source, sha256, avertissements des motifs) dans son frontmatter. L'empreinte est revérifiée sur la copie : un fichier remplacé pendant la copie n'installe rien.
- **Lancement** : toute commande bash (exécution tamponnée, en flux, ou argv) dont l'analyse (tree-sitter-bash) fait apparaître un fichier d'un skill importé `imported-*` passe par `ConfirmationService` avec `forcePrompt` : chemin écrit, interpréteur + chemin quelle que soit l'extension (`bash notes.txt`), glob (`*`, `?`, classes POSIX `[[:alpha:]]`, `[!0-9]`) et accolades développés, littéraux d'une liste `for … in`, et le corps réanalysé récursivement de `bash -c`/`sh -c`/`eval`/`env -S`/`python -c`/`node -e`. Les enveloppes sont traversées avec leurs options à argument (`env -u X`, `nice -n +5`, `stdbuf -o L`, `timeout -s KILL 5`, `flock -n f`, `ionice`, `sudo -u`…). Aucune auto-approbation (YOLO, `dontAsk`, `bypassPermissions`, `CODEBUDDY_AUTO_CONFIRM`, accord de session) ; sans humain, refus. Seules les commandes de lecture (`cat`, `ls`, `grep`…) sur des DOCUMENTS et `cd` ne déclenchent rien ; lire un script demande. Le sha256 est recalculé juste avant le lancement : si le fichier a changé depuis l'approbation, la commande est refusée. Les avertissements de l'analyse par motifs sont affichés dans la confirmation.
- **Liste blanche** : `~/.codebuddy/skill-exec-allowlist.json` (absente donc vide par défaut) lève la confirmation, fichier par fichier, sur le sha256 du fichier COURANT :

```json
{ "entries": [ { "source": "hermes", "path": "productivity/maps/scripts/maps_client.py", "sha256": "<64 hex>" } ] }
```

`source` est l'étiquette de l'import (`--source <nom>`, ou le nom du dossier pour `--dir`, par exemple `skills` pour `~/.hermes/skills`), `path` le chemin relatif au dossier source (séparateurs `/`). `buddy skills import` affiche, pour chaque skill importé avec des scripts inertes, la ligne exacte à copier après relecture du fichier. Un binaire ou une archive n'est importé que par une entrée explicite. Un fichier de configuration invalide est ignoré (liste vide, avertissement). Skill Exchange applique la même porte (source `exchange`).

**Frontière garantie (reprises 15 à 18).** (a) Les scripts importés sont inertes. (b) Quand un skill importé a un script non autorisé et qu'un outil d'exécution (BashTool tamponné, flux et argv, `execute_code`, `code_exec`, shell interactif, `app_server`, `run_script`, cellules de notebook) reçoit un texte où l'analyse fait apparaître un fichier de ce skill, une confirmation humaine forcée est demandée. « Fait apparaître » veut dire : chemin écrit ; chemin développé par glob ou accolades ; littéral d'une liste `for` ; chemin dans le corps de `bash -c`, `sh -c`, `eval`, `env -S` ou d'un `-c`/`-e` d'interpréteur, ou dans le texte qu'un shell ou un interpréteur lit sur son entrée standard (here-document, here-string, tube, `while read … <<EOF`), réanalysés récursivement ; chemin derrière une enveloppe connue et ses options à argument. Trois règles de fermeture complètent : `find -exec/-execdir/-ok`, `xargs`, `parallel`, `make` (où qu'ils soient dans la commande) demandent quand le dossier courant ou un argument contient ou recouvre le dossier des skills ; un texte que l'analyseur ne sait pas lire demande ; un mot de commande qu'il ne sait pas résoudre (variable, glob, option) demande. (c) Le sha256 d'un fichier désigné est recalculé juste avant le lancement. Sous `CODEBUDDY_NATIVE_SANDBOX=bwrap`, la racine des skills importés est en plus masquée (tmpfs). Pas garanti : une construction qu'aucune de ces règles ne décrit (voir la limite assumée).

**Limite assumée, non chassée par motifs.** Si l'agent recopie ou reconstruit le script AILLEURS puis lance la copie (`cp`, `cat > x`, `install`, `printf`, nom assemblé par octets ou par `chr`/`bytes`, valeur passée par `os.environ`/`sys.argv`/`env`/`args` d'un outil, `create_file` qui refait le geste), la garde ne le voit pas. C'est équivalent à « l'agent réécrit le script à la main » : un agent qui sait écrire un fichier sait le faire, avec ou sans le skill. La reprise 16 a retiré les heuristiques (le développement des globs et accolades du fichier d'origine a été remis en reprise 17-18, car il désigne un fichier du skill) de « nom calculé » (variable, substitution, concaténation, base64, `exec(open(...))`) : elles ne fermaient pas la classe et faisaient demander des commandes sans rapport (`bash -c "echo $X"`). La confirmation n'est pas un bac ; le confinement reste `CODEBUDDY_NATIVE_SANDBOX`. Une approbation d'un hit « dossier recouvert » n'est pas liée au contenu d'un fichier précis (aucun fichier désigné).

*Pourquoi pas un bac noexec/lecture seule comme barrière.* Landlock ne sait pas retirer un droit à l'intérieur d'un sous-arbre déjà accordé (le cwd), `noexec` n'empêche pas `bash fichier` (lecture seule suffit à un interpréteur), bwrap n'est pas toujours utilisable, `execute_code` ne tourne pas dans ce bac, et une escalade approuvée sort du bac. Rendre les scripts illisibles (chmod 000) casse la relecture avant liste blanche et tombe au premier `chmod` à chemin assemblé. Un confinement du système de fichiers ne peut donc être qu'une couche, pas la barrière ; la barrière est la confirmation du lancement direct, dans la limite ci-dessus.

Limites assumées : la détection par nom ou par octets est un indice, pas la barrière (un `.txt` sans shebang n'est pas reconnu, mais le lancer demande quand même confirmation) ; l'analyse du lancement est lexicale et ne vise que le lancement direct (voir « Limite assumée » ci-dessus) ; le contenu copié par `cat f > g` puis lancé hors du dossier du skill n'est pas vu ; la confirmation n'est pas un sandbox (`CODEBUDDY_NATIVE_SANDBOX` reste le confinement). Code : `src/security/skill-executable-gate.ts`, `src/skills/skill-importer.ts`, `src/tools/bash/imported-skill-guard.ts`.

Le pare-feu analyse le manifeste et tous les fichiers copiés, sans exclure les charges `.txt`, les suffixes inconnus ou les scripts sans extension. Le shebang fournit le langage ; un langage inconnu impose une revue ou une quarantaine pour un opérateur de processus. Les processus Python/Node
et autres appels natifs, les suppressions récursives et les références de secrets sont
signalés, y compris les modules préfixés (`SAFE_subprocess`, `SAFE_child_process`), les affectations de secrets littéraux (`apiKey`, `secret`), les lanceurs shell et les appels de suppression déstructurés ou optionnels (`rm?.(...)`) et les backticks shell.
Les backticks révélés par NFKC (U+FF40 ou U+1FEF) passent par la même analyse de langage et de contexte littéral que les opérateurs ASCII. Ce repli minimal et la lecture des langages de clôture contenant des caractères invisibles sont obligatoires, même avec `CODEBUDDY_SKILL_FIREWALL_DEOB_ALL=false`. Ce réglage ne désactive que la passe étendue.
Une occurrence bénigne de prose ou Swift ne masque pas un autre appel sur la même
ligne. Une référence ambiguë comme `operating system(whoami)` impose une revue ; les parenthèses de prose reconnues, comme `system (Linux)`, restent acceptées. Les commentaires HTML sont scannés. La prose et les exemples Markdown conservent une revue sans accumuler
les pénalités des scripts. Les occurrences critiques gardent leur sévérité d’origine. Les mentions réseau non critiques des références Markdown restent en revue, sans provoquer une quarantaine par simple accumulation ; les références contenant une règle critique restent bloquées ou en revue selon son contexte. Le code copié dans `scripts/`, les fichiers exécutables et les shebangs
conservent les règles strictes, même si leurs commentaires parlent de sécurité.
Les assertions Kotlin/Solidity ne sont pas des évaluations dynamiques. Le passage
PyTorch `model.eval()` sans argument dans la documentation reste en revue ; les
autres récepteurs eval et les scripts sont bloqués. Les avertissements explicites
et les substitutions documentaires reconnues (mktemp, lecture jq, calcul echo/bc)
restent en revue ; les substitutions inconnues conservent leurs pénalités,
une commande dangereuse active conserve sa quarantaine. `--include-review` est le choix
explicite pour copier les skills en revue à des fins d’inspection, sans contourner
la quarantaine. Le registre, Exchange et les générations automatiques exigent
`allow` : une copie en revue ne devient pas un skill automatiquement chargé.

`--agents` analyse également les fichiers **directs** `agents/*.md` avec le même
pare-feu, avec une politique plus stricte : leurs motifs critiques et élevés sont actifs même dans une citation documentaire. Les agents non quarantainés sont préparés dans
`$CODEBUDDY_HOME/agents/review/imported-<nom>.md` (par défaut sous `~/.codebuddy`), avec `disabled: true` et
`permissionMode: suggest`. Ils restent désactivés, même avec `--include-review`.
Ils portent la source, le chemin source, son SHA-256 et le verdict du pare-feu.
Un fichier préparé existant n'est jamais remplacé. La décision d'activation appartient
à la revue humaine : après inspection, retirer `disabled: true` et déplacer le
fichier dans `agents/`. Le chargeur utilisé par `buddy --agent` lit aussi les `.md`
directs, en modes synchrone et asynchrone. Il refuse un fichier marqué désactivé.

| Outil Claude Code | Outil Code Buddy |
|---|---|
| Read | view_file |
| Write | create_file |
| Edit | str_replace_editor |
| Bash | bash |
| Grep, Glob | search (texte ou fichiers) |
| WebFetch, WebSearch | web_fetch, web_search |
| TodoWrite | todo_update |
| AskUserQuestion | ask_human |

Un outil externe inconnu ou une liste absente/illisible refuse la préparation de
l'agent. Les chargeurs acceptent `tools: Read, Grep, Glob` et les tableaux YAML/JSON/TOML.
Une allowlist locale doit contenir des noms ou motifs positifs bornés, comme
`Read`, `view_?ile` ou `*file*`. `tools: "*"`, `tools: "**"` et les négations
comme `tools: ["!bash"]` refusent le fichier ; elles ne peuvent pas ouvrir les
outils par complément. `disabledTools: ["*"]` signifie en revanche tout refuser. Les refus sont propagés
aux alias équivalents, dont `terminal`, `shell_exec` et `interactive_shell` pour Bash.
Les anciennes descriptions YAML contenant un deux-points non cité sont normalisées
sans réparation des listes d’outils.
Une liste explicitement vide n'autorise aucun outil. Une politique présente mais
illisible refuse le chargement au lieu de devenir une permission générale. Pour
une ancienne configuration qui utilisait `tools: []` pour hériter des outils, il
faut supprimer le champ après décision explicite ; il signifie désormais un refus total.

Les hooks ne font pas partie de cet import.
