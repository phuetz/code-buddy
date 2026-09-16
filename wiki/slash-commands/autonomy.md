# /autonomy

[Accueil](Home.md) · [Wiki interactif](index.html#autonomy)

Régler le niveau d’autonomie.

## Syntaxe du catalogue

```text
/autonomy [level]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| level | Non | Autonomy level |

## Recette : TESTE\_LOCAL

```text
/autonomy
```

Sans argument, affiche correctement le niveau courant CONFIRM et son aide. Aucun changement de niveau n’a été testé.

Attendu : État ou aide des niveaux d’autonomie ; aucun changement demandé.

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/autonomy/terminal.txt)

## Invocation prévue

```text
/autonomy
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Set autonomy level (suggest, confirm, auto, full, yolo)
