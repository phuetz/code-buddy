# /tdd

[Accueil](Home.md) · [Wiki interactif](index.html#tdd)

Activer le développement guidé par les tests.

## Syntaxe du catalogue

```text
/tdd [action]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| action | Non | start \<requirements\>, status, approve, cancel |

## Recette : TESTE\_LOCAL

```text
/tdd status
```

consultation de l'état actuel du mode TDD (inactif).

Attendu : Affichage de l'etat actuel du mode TDD

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/tdd/terminal.txt)

## Invocation prévue

```text
/tdd status
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Enter TDD mode - test-first development (45% accuracy improvement)
