# /team

[Accueil](Home.md) · [Wiki interactif](index.html#team)

Gérer une équipe d’agents.

## Syntaxe du catalogue

```text
/team [action]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| action | Non | start \[goal\], add \<role\>, remove \<id\>, status, stop, task \[title\], assign \<task\> \<member\>, complete \<task\>, send \<to\> \<msg\>, inbox |

## Recette : TESTE\_LOCAL

```text
/team status
```

/team status (branche statut inactif / aucune équipe).

Attendu : Statut de la coordination des equipes d'agents

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/team/terminal.txt)

## Invocation prévue

```text
/team status
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Manage Agent Teams for multi-agent coordination (start, add, status, stop)
