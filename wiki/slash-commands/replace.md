# /replace

[Accueil](Home.md) · [Wiki interactif](index.html#replace)

Rechercher et remplacer du texte dans plusieurs fichiers.

## Syntaxe du catalogue

```text
/replace <search> <replacement>
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| search | Oui | Search pattern (text or /regex/) |
| replacement | Oui | Replacement string |

## Recette : TESTE\_LOCAL

```text
/replace QA_CHANGE QA_REPLACED
```

Une occurrence remplacée dans invoice.js ; git-after.txt confirme QA\_REPLACED à la place de QA\_CHANGE.

Attendu : Le marqueur QA\_CHANGE dans invoice.js devient QA\_REPLACED, modification prouvée par git diff.

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/replace/terminal.txt)

## Invocation prévue

```text
/replace QA_CHANGE QA_REPLACED
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Codebase-wide find & replace across files
