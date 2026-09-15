# /watch

[Accueil](Home.md) · [Wiki interactif](index.html#watch)

Déclencher des contrôles lorsque les fichiers changent.

## Syntaxe du catalogue

```text
/watch [action]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| action | Non | start \[patterns...\], stop, status |

## Recette : TESTE\_LOCAL

```text
/watch status
```

consultation du statut du processus de surveillance des fichiers (inactif).

Attendu : Affichage du statut du processus de surveillance des fichiers

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/watch/terminal.txt)

## Invocation prévue

```text
/watch status
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Watch source files for changes and trigger actions (lint, test, typecheck)
