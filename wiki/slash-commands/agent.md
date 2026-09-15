# /agent

[Accueil](Home.md) · [Wiki interactif](index.html#agent)

Gérer les agents personnalisés.

## Syntaxe du catalogue

```text
/agent [action]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| action | Non | list, \<id\>, create \<name\>, info \<id\>, reload |

## Recette : ECHEC

```text
/agent list
```

Aucune liste ni réponse après /agent list, malgré 60 secondes d’attente. Le champ de saisie est vidé.

Attendu : Liste des agents personnalises disponibles

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/replays-async/cases/agent/terminal.txt)

## Invocation prévue

```text
/agent list
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Manage and activate custom agents
