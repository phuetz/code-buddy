# /secrets-scan

[Accueil](Home.md) · [Wiki interactif](index.html#secrets-scan)

Rechercher des secrets inscrits dans les fichiers.

## Syntaxe du catalogue

```text
/secrets-scan [path]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| path | Non | File or directory path to scan (default: current directory) |

## Recette : TESTE\_LOCAL

```text
/secrets-scan
```

analyse du projet à la recherche de secrets et identifiants en clair.

Attendu : Analyse du repertoire a la recherche de secrets et cles d'API en clair

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/secrets-scan/terminal.txt)

## Invocation prévue

```text
/secrets-scan
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Scan project for hardcoded secrets, API keys, and credentials
