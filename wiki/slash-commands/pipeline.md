# /pipeline

[Accueil](Home.md) · [Wiki interactif](index.html#pipeline)

Exécuter et gérer des pipelines.

## Syntaxe du catalogue

```text
/pipeline [action]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| action | Non | run \<file\|pipe-syntax\>, list, validate \<file\>, status, or pipeline name (code-review, bug-fix, feature-development, security-audit, documentation) |

## Recette : TESTE\_LOCAL

```text
/pipeline list
```

/pipeline list (liste des pipelines disponibles).

Attendu : Liste des pipelines disponibles

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/pipeline/terminal.txt)

## Invocation prévue

```text
/pipeline list
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Run or manage pipeline workflows (pipe syntax or file-based)
