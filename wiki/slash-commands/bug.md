# /bug

[Accueil](Home.md) · [Wiki interactif](index.html#bug)

Analyser statiquement des fichiers pour détecter des bugs.

## Syntaxe du catalogue

```text
/bug [path] [--severity]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| path | Non | File or directory to scan (default: current directory) |
| --severity | Non | Filter by minimum severity: critical, high |

## Recette : TESTE\_LOCAL

```text
/bug .
```

analyse statique du répertoire à la recherche de bugs potentiels.

Attendu : Analyse statique du repertoire pour detecter les bugs potentiels

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/bug/terminal.txt)

## Invocation prévue

```text
/bug .
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Scan files or directories for potential bugs using static analysis
