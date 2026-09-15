# /merge

[Accueil](Home.md) · [Wiki interactif](index.html#merge)

Fusionner une branche de conversation.

## Syntaxe du catalogue

```text
/merge <branch>
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| branch | Oui | Branch ID to merge |

## Recette : VALIDATION\_SEULE

```text
/merge test-branch
```

validation de l'argument de branche inexistante ou non trouvée.

Attendu : Fusion de la branche de conversation specifiee dans la session active

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/merge/terminal.txt)

## Invocation prévue

```text
/merge test-branch
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Merge a branch into current conversation
