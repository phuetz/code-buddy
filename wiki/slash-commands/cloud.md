# /cloud

[Accueil](Home.md) · [Wiki interactif](index.html#cloud)

Gérer les tâches des agents cloud.

## Syntaxe du catalogue

```text
/cloud [action]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| action | Non | submit "\<goal\>", status \<taskId\>, list, cancel \<taskId\>, logs \<taskId\>, delete \<taskId\> |

## Recette : TESTE\_LOCAL

```text
/cloud list
```

/cloud list (branche liste vide / aucune tâche distante).

Attendu : Liste des taches d'agents distantes dans le cloud

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/cloud/terminal.txt)

## Invocation prévue

```text
/cloud list
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Manage cloud background agent tasks (submit, status, list, cancel, logs)
