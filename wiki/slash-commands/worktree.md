# /worktree

[Accueil](Home.md) · [Wiki interactif](index.html#worktree)

Gérer des répertoires de travail Git parallèles.

## Syntaxe du catalogue

```text
/worktree [action]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| action | Non | list, add \<path\> \[branch\], remove \<path\>, prune, lock, unlock |

## Recette : TESTE\_LOCAL

```text
/worktree list
```

affichage de la liste des worktrees git actifs.

Attendu : Affichage de la liste des worktrees git actifs

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/worktree/terminal.txt)

## Invocation prévue

```text
/worktree list
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Manage git worktrees for parallel instances (Standard)
