# /copy

[Accueil](Home.md) · [Wiki interactif](index.html#copy)

Copier une réponse, du code ou du texte dans le presse-papiers.

## Syntaxe du catalogue

```text
/copy [target]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| target | Non | "code" for last code block, or text to copy. Empty copies last response. |

## Recette : VALIDATION\_SEULE

```text
/copy code
```

garde-fou en l'absence de réponse de l'assistant à copier.

Attendu : Aucun bloc de code disponible dans la conversation vide ; presse-papier inchangé.

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/copy/terminal.txt)

## Invocation prévue

```text
/copy code
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Copy to clipboard: last response, last code block, or specified text
