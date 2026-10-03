# Importer une bibliothèque de skills et d'agents

```bash
buddy skills import --dir /chemin/bibliotheque --agents --json
buddy skills import --dir /chemin/bibliotheque --agents --apply --json
```

Sans `--apply`, la commande ne fait qu'analyser. Si la bibliothèque possède une racine
`skills/`, elle est canonique : les copies documentaires, traductions et intégrations
situées ailleurs sont ignorées. Les traductions du même identifiant sous cette racine
sont dédoublonnées. Le rapport donne chaque chemin ignoré et sa raison. Deux skills
indépendants portant le même nom conservent chacun un nom d'import distinct.

Le pare-feu analyse le manifeste et les fichiers associés. Les processus Python/Node
et autres appels natifs, les suppressions récursives et les secrets à préfixe sont
signalés. Le code copié dans `scripts/`, les fichiers exécutables et les shebangs
conservent les règles strictes, même si leurs commentaires parlent de sécurité.
Les assertions Kotlin/Solidity ne sont pas des évaluations dynamiques. Le passage
PyTorch `model.eval()` sans argument dans la documentation reste en revue ; les
autres récepteurs eval et les scripts sont bloqués. Les avertissements explicites
et les substitutions documentaires reconnues (mktemp, lecture jq, calcul echo/bc)
restent en revue ; les substitutions inconnues conservent leurs pénalités,
une commande dangereuse active conserve sa quarantaine. `--include-review` est le choix
explicite existant pour installer les skills en revue, sans contourner la quarantaine.

`--agents` analyse également les fichiers **directs** `agents/*.md` avec le même
pare-feu. Les agents non quarantainés sont préparés dans
`~/.codebuddy/agents/review/imported-<nom>.md`, avec `disabled: true` et
`permissionMode: suggest`. Ils restent désactivés, même avec `--include-review`.
Ils portent la source, le chemin source, son SHA-256 et le verdict du pare-feu.
Un fichier préparé existant n'est jamais remplacé. La décision d'activation appartient
à la revue humaine ; les chargeurs refusent un fichier marqué désactivé.

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
Une liste explicitement vide n'autorise aucun outil. Une politique présente mais
illisible refuse le chargement au lieu de devenir une permission générale.

Les hooks ne font pas partie de cet import.
