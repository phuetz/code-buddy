# /diff

[Accueil](Home.md) · [Wiki interactif](index.html#diff)

Voir les changements Git ou comparer des points de restauration.

## Syntaxe du catalogue

```text
/diff [from] [to]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| from | Non | Checkpoint ID (optional, omit for git diff) |
| to | Non | Second checkpoint ID |

## Recette : TESTE\_LOCAL

```text
/diff
```

affichage des modifications git locales non indexées.

Attendu : Affichage des modifications git non validees

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/diff/terminal.txt)

## Invocation prévue

```text
/diff
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Show uncommitted git changes, or diff between checkpoints
