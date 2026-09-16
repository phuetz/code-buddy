# /daily-reset

[Accueil](Home.md) · [Wiki interactif](index.html#daily-reset)

Gérer la réinitialisation quotidienne de conversation.

## Syntaxe du catalogue

```text
/daily-reset [action]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| action | Non | enable \| disable \| status \| run (default: status) |

## Recette : TESTE\_LOCAL

```text
/daily-reset status
```

/daily-reset status (consultation de l'état du gestionnaire de réinitialisation).

Attendu : Statut du planificateur de reinitialisation quotidienne

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/daily-reset/terminal.txt)

## Invocation prévue

```text
/daily-reset status
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Manage the daily reset scheduler (enable/disable/status/run) — clear conversation at configured time
