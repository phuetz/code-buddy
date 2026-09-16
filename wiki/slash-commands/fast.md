# /fast

[Accueil](Home.md) · [Wiki interactif](index.html#fast)

Configurer le mode à faible latence.

## Syntaxe du catalogue

```text
/fast [action]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| action | Non | on, off, toggle, status, model \<name\> |

## Recette : TESTE\_LOCAL

```text
/fast status
```

consultation du statut et des modèles disponibles du mode fast.

Attendu : Affichage de l'etat actuel du mode fast

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/fast/terminal.txt)

## Invocation prévue

```text
/fast status
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Toggle fast mode (switch to low-latency model with service\_tier=flex)
