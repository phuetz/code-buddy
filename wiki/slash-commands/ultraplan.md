# /ultraplan

[Accueil](Home.md) · [Wiki interactif](index.html#ultraplan)

Faire construire un plan par plusieurs agents spécialisés.

## Syntaxe du catalogue

```text
/ultraplan <prompt>
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| prompt | Oui | The task to plan for |

## Recette : VALIDATION\_SEULE

```text
/ultraplan
```

validation de la présence de l'argument prompt requis.

Attendu : Affichage du sélecteur ou validation des arguments/prérequis ; action complète non validée.

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/ultraplan/terminal.txt)

## Invocation prévue

```text
/ultraplan
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Spawn parallel specialized agents to research and synthesize the best execution plan (Best-of-N)
