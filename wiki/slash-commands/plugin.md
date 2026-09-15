# /plugin

[Accueil](Home.md) · [Wiki interactif](index.html#plugin)

Gérer un plugin avec contrôle du propriétaire.

## Syntaxe du catalogue

```text
/plugin [action]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| action | Non | install \<id\>, uninstall \<id\>, enable \<id\>, disable \<id\>, status |

## Recette : TESTE\_LOCAL

```text
/plugin status
```

/plugin status (statut du système de plugins à l'état initial).

Attendu : Statut de gestion des plugins

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/plugin/terminal.txt)

## Invocation prévue

```text
/plugin status
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Manage a single plugin (owner-gated, singular alias for /plugins)
