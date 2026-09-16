# /btw

[Accueil](Home.md) · [Wiki interactif](index.html#btw)

Poser une question annexe sans modifier le contexte de conversation.

## Syntaxe du catalogue

```text
/btw <question>
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| question | Oui | Your side question |

## Recette : TESTE\_LOCAL

```text
/btw Combien font 2 + 2 ? Réponds par un nombre.
```

Le modèle local répond réellement « 4 » à la question 2 + 2. Le premier runner avait conclu trop tôt ; ce faux échec est retiré.

Attendu : Réponse réelle du modèle : 4.

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/replays-async/cases/btw/terminal.txt)

## Invocation prévue

```text
/btw Combien font 2 + 2 ? Réponds par un nombre.
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Ask a quick side question without modifying conversation context
