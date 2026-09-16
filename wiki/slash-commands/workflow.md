# /workflow

[Accueil](Home.md) · [Wiki interactif](index.html#workflow)

Gérer les workflows CI/CD.

## Syntaxe du catalogue

```text
/workflow [action]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| action | Non | list, status, create \<template\>, run \<name\>, validate \<file\> |

## Recette : TESTE\_LOCAL

```text
/workflow list
```

/workflow list (branche liste vide / aucun workflow détecté).

Attendu : Liste des workflows CI/CD

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/workflow/terminal.txt)

## Invocation prévue

```text
/workflow list
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Manage CI/CD workflows (GitHub Actions, GitLab CI)
