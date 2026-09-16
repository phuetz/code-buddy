# /transform

[Accueil](Home.md) · [Wiki interactif](index.html#transform)

Transformer le code selon une stratégie.

## Syntaxe du catalogue

```text
/transform [type] [file]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| type | Non | modernize, typescript, async, functional, es-modules |
| file | Non | File or directory to transform |

## Recette : TESTE\_LOCAL

```text
/transform modernize invoice.js
```

/transform modernize (analyse du code source et diagnostic de modernisation).

Attendu : Transformation et modernisation du code source cible

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/transform/terminal.txt)

## Invocation prévue

```text
/transform modernize invoice.js
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Transform code: modernize, typescript, async, functional, es-modules
