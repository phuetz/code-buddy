# /share

[Accueil](Home.md) · [Wiki interactif](index.html#share)

Gérer le partage de session.

## Syntaxe du catalogue

```text
/share [action]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| action | Non | enable \| disable \| status \| create \<name\> \| join \<id\> \| list \| leave |

## Recette : TESTE\_LOCAL

```text
/share status
```

/share status (consultation de l'état du gestionnaire de session partagée).

Attendu : Statut du partage de session

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/share/terminal.txt)

## Invocation prévue

```text
/share status
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Share a coding session with team members (enable/disable/status/create/join/list/leave) — local-first V0.1, WS sync V0.2
