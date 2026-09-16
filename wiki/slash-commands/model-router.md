# /model-router

[Accueil](Home.md) · [Wiki interactif](index.html#model-router)

Configurer le routage des modèles.

## Syntaxe du catalogue

```text
/model-router [action]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| action | Non | status, on, off, models, compare \[tokens\], sensitivity \<level\>, stats |

## Recette : TESTE\_LOCAL

```text
/model-router status
```

consultation du statut et de la table de routage des modèles.

Attendu : Affichage du statut et des statistiques du routeur de modeles

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/model-router/terminal.txt)

## Invocation prévue

```text
/model-router status
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Manage model routing for cost optimization (30-70% savings)
