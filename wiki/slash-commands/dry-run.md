# /dry-run

[Accueil](Home.md) · [Wiki interactif](index.html#dry-run)

Prévisualiser les changements sans les appliquer.

## Syntaxe du catalogue

```text
/dry-run [action]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| action | Non | on, off, or status |

## Recette : TESTE\_LOCAL

```text
/dry-run status
```

consultation du statut du mode simulation dry-run (désactivé).

Attendu : Affichage du statut d'activation du mode simulation dry-run

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/dry-run/terminal.txt)

## Invocation prévue

```text
/dry-run status
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Toggle dry-run mode (preview changes without applying)
