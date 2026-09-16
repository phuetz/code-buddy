# /model

[Accueil](Home.md) · [Wiki interactif](index.html#model)

Choisir le modèle ou le routage automatique.

## Syntaxe du catalogue

```text
/model [model]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| model | Non | Model name to switch to, or "auto" for automatic routing |

## Recette : VALIDATION\_SEULE

```text
/model
```

affichage du sélecteur interactif de modèle sans basculement effectif.

Attendu : Confirmation du basculement du modele sur auto

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/model/terminal.txt)

## Invocation prévue

```text
/model
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Change the AI model (use "auto" for automatic routing by task complexity)
