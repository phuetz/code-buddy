# /security-review

[Accueil](Home.md) · [Wiki interactif](index.html#security-review)

Lancer une revue de sécurité.

## Syntaxe du catalogue

```text
/security-review [action] [path]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| action | Non | full-scan, quick-scan, detect-secrets, audit-deps, audit-perms, report \[format\] |
| path | Non | Target path to scan (default: cwd) |

## Recette : TESTE\_LOCAL

```text
/security-review quick-scan
```

exécution d'une analyse rapide de sécurité (quick-scan).

Attendu : Execution d'une analyse rapide de securite

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/security-review/terminal.txt)

## Invocation prévue

```text
/security-review quick-scan
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Run comprehensive security scan (OWASP, secrets, dependencies)
