# /scan-todos

[Accueil](Home.md) · [Wiki interactif](index.html#scan-todos)

Rechercher les commentaires adressés à l’IA.

## Syntaxe du catalogue

```text
/scan-todos
```

Le catalogue ne détaille pas les arguments de cette commande ; cela ne signifie pas qu’elle n’en accepte aucun.

## Recette : ECHEC

```text
/scan-todos
```

Aucun rapport après /scan-todos, malgré 60 secondes d’attente. La fixture contient un TODO, mais aucun résultat utilisateur ne permet de valider la commande.

Attendu : Rapport de detection des commentaires AI directifs

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/replays-async/cases/scan-todos/terminal.txt)

## Invocation prévue

```text
/scan-todos
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Scan for AI-directed comments (// AI: fix this)
