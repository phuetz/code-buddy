# /subgoal

[Accueil](Home.md) · [Wiki interactif](index.html#subgoal)

Gérer les critères de réussite de l’objectif actif.

## Syntaxe du catalogue

```text
/subgoal [action]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| action | Non | \<text\> to add a criterion, remove \<n\>, clear, or empty to list |

## Recette : VALIDATION\_SEULE

```text
/subgoal
```

garde-fou en l'absence d'objectif actif pour les critères d'acceptation.

Attendu : Affichage de la liste des criteres d'acceptation de l'objectif actif

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/subgoal/terminal.txt)

## Invocation prévue

```text
/subgoal
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Add acceptance criteria to the active goal: /subgoal \<text\> \| remove \<n\> \| clear
