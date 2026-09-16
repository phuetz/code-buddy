# /batch

[Accueil](Home.md) · [Wiki interactif](index.html#batch)

Décomposer un objectif et exécuter ses unités en parallèle.

## Syntaxe du catalogue

```text
/batch <instruction>
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| instruction | Oui | The goal to decompose and execute in parallel |

## Recette : VALIDATION\_SEULE

```text
/batch
```

/batch sans argument (garde-fou syntaxique).

Attendu : Validation des arguments sans démarrer de tâche multi-agents.

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/batch/terminal.txt)

## Invocation prévue

```text
/batch
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Decompose a goal into parallel units and execute with separate agents
