# /goal

[Accueil](Home.md) · [Wiki interactif](index.html#goal)

Définir un objectif persistant et contrôler sa poursuite.

## Syntaxe du catalogue

```text
/goal [action]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| action | Non | \<text\> to set a goal, or status, pause, resume, clear |

## Recette : TESTE\_LOCAL

```text
/goal status
```

consultation du statut de l'objectif persistant en l'absence d'objectif actif.

Attendu : Affichage de l'etat actuel de l'objectif persistant et de la boucle Ralph

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/goal/terminal.txt)

## Invocation prévue

```text
/goal status
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Standing goal with judge + auto-continue loop (Ralph loop): /goal \<text\> \| status \| pause \| resume \| clear
