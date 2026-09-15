# /ai-test

[Accueil](Home.md) · [Wiki interactif](index.html#ai-test)

Tester l’intégration du fournisseur IA courant.

## Syntaxe du catalogue

```text
/ai-test [options]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| options | Non | quick (skip expensive), full (all tests), tools (test tool calling), stream (test streaming) |

## Recette : ECHEC

```text
/ai-test quick
```

exécution des tests d'intégration IA interrompue par timeout.

Attendu : Execution des tests d'integration du fournisseur d'IA

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/ai-test/terminal.txt)

## Invocation prévue

```text
/ai-test quick
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Run integration tests on the current AI provider
