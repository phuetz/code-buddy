# /conflicts

[Accueil](Home.md) · [Wiki interactif](index.html#conflicts)

Détecter et résoudre les conflits Git.

## Syntaxe du catalogue

```text
/conflicts [action]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| action | Non | scan, show \<file\>, resolve \<file\> \[ours\|theirs\|both\] |

## Recette : ECHEC

```text
/conflicts scan
```

Le gestionnaire annonce Git absent ou dossier hors dépôt. La fixture est pourtant un dépôt Git valide : initialisation, commit et diff ont réussi. Aucun conflit de fusion n’était présent.

Attendu : Detection et rapport des conflits de fusion git

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/conflicts/terminal.txt)

## Invocation prévue

```text
/conflicts scan
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Detect and resolve Git merge conflicts
