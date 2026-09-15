# /search

[Accueil](Home.md) · [Wiki interactif](index.html#search)

Rechercher du texte dans le code avec ripgrep.

## Syntaxe du catalogue

```text
/search <query>
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| query | Oui | Search pattern (text or regex) |

## Recette : ECHEC

```text
/search QA_CHANGE
```

/search QA\_CHANGE annonce zéro résultat alors que invoice.js contient ce marqueur, attesté par git-after.txt. Le scénario de recherche positive échoue.

Attendu : Recherche du marqueur QA\_CHANGE dans la fixture, sans correspondance inventée.

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/search/terminal.txt)

## Invocation prévue

```text
/search QA_CHANGE
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Search codebase for a text pattern (uses ripgrep)
