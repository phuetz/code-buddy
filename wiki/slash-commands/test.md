# /test

[Accueil](Home.md) · [Wiki interactif](index.html#test)

Exécuter les tests du projet.

## Syntaxe du catalogue

```text
/test [file]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| file | Non | Test file to run (optional, runs all if omitted) |

## Recette : TESTE\_LOCAL

```text
/test
```

exécution de la suite de tests automatisés du projet.

Attendu : Execution de la suite de tests du projet ou rapport d'absence de tests

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/test/terminal.txt)

## Invocation prévue

```text
/test
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Run tests directly (optionally specify a file)
