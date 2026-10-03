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

Le pare-feu analyse le manifeste et les fichiers associés. Les processus Python/Node
et autres appels natifs, les suppressions récursives et les références de secrets sont
signalés, y compris les appels de suppression déstructurés et les backticks shell.
Une occurrence bénigne de prose ou Swift ne masque pas un autre appel sur la même
ligne. Les commentaires HTML sont scannés. La prose et les exemples Markdown conservent une revue sans accumuler
les pénalités des scripts. Les occurrences critiques gardent leur sévérité d’origine. Le code copié dans `scripts/`, les fichiers exécutables et les shebangs
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
pare-feu. Les agents non quarantainés sont préparés dans
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
