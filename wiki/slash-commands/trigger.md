# /trigger

[Accueil](Home.md) · [Wiki interactif](index.html#trigger)

Gérer les déclencheurs par webhook.

## Syntaxe du catalogue

```text
/trigger [action]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| action | Non | add --source \<s\> --events \<e\> --action \<a\>, list, remove \<id\>, test \<id\> |

## Recette : TESTE\_LOCAL

```text
/trigger list
```

/trigger list (branche liste vide / aucun déclencheur configuré).

Attendu : Liste des declencheurs de webhooks configures

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/trigger/terminal.txt)

## Invocation prévue

```text
/trigger list
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Manage event-driven webhook triggers (GitHub, GitLab, Slack, Linear, PagerDuty)
