# /switch

[Accueil](Home.md) · [Wiki interactif](index.html#switch)

Changer de modèle pendant la conversation.

## Syntaxe du catalogue

```text
/switch [model]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| model | Non | Model name or "auto" to revert |

## Recette : ECHEC

```text
/switch auto
```

/switch auto réclame une session d’agent active alors que le test tourne dans le vrai CLI avec un agent actif. Basculement non validé ; liaison au gestionnaire à vérifier.

Attendu : Reversion du modele courant vers le reglage auto par defaut

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/switch/terminal.txt)

## Invocation prévue

```text
/switch auto
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Switch model mid-conversation (use "auto" to revert to default)
