# /coverage

[Accueil](Home.md) · [Wiki interactif](index.html#coverage)

Vérifier la couverture des tests.

## Syntaxe du catalogue

```text
/coverage [action]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| action | Non | check (default), targets |

## Recette : TESTE\_LOCAL

```text
/coverage targets
```

/coverage targets (affichage des objectifs configurés de couverture).

Attendu : Affichage des cibles de couverture de code configurees

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/coverage/terminal.txt)

## Invocation prévue

```text
/coverage targets
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Check test coverage against configured targets
