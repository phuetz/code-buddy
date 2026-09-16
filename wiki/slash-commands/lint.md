# /lint

[Accueil](Home.md) · [Wiki interactif](index.html#lint)

Détecter et exécuter les outils de contrôle du code.

## Syntaxe du catalogue

```text
/lint [action]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| action | Non | run (default), fix (auto-correct), detect (show detected linters) |

## Recette : TESTE\_LOCAL

```text
/lint detect
```

détection des linters en l'absence de linter configuré.

Attendu : Detection et affichage des linters configures dans le projet

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/lint/terminal.txt)

## Invocation prévue

```text
/lint detect
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Auto-detect and run project linters (eslint, ruff, clippy, golangci-lint, rubocop, phpstan)
