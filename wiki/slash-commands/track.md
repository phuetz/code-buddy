# /track

[Accueil](Home.md) · [Wiki interactif](index.html#track)

Gérer des travaux guidés par une spécification.

## Syntaxe du catalogue

```text
/track [action]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| action | Non | new, implement, status, list, complete, setup, context, update |

## Recette : TESTE\_LOCAL

```text
/track list
```

/track list (branche liste vide / aucun track existant).

Attendu : Liste des tracks de developpement

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/track/terminal.txt)

## Invocation prévue

```text
/track list
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Manage development tracks (features, bugs) with spec-driven workflow
