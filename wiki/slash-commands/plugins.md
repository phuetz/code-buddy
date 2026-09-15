# /plugins

[Accueil](Home.md) · [Wiki interactif](index.html#plugins)

Gérer les plugins installés et leur catalogue.

## Syntaxe du catalogue

```text
/plugins [action]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| action | Non | list, search \<query\>, install \<id\>, uninstall \<id\>, update \<id\>, status |

## Recette : TESTE\_LOCAL

```text
/plugins list
```

/plugins list (branche liste vide / aucun plugin installé).

Attendu : Liste des plugins installes et de la marketplace

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/plugins/terminal.txt)

## Invocation prévue

```text
/plugins list
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Manage plugin marketplace and installed plugins
