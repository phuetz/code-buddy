# /vulns

[Accueil](Home.md) · [Wiki interactif](index.html#vulns)

Rechercher des vulnérabilités connues dans les dépendances.

## Syntaxe du catalogue

```text
/vulns [package_manager]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| package\_manager | Non | npm, pip, cargo, go (optional, scans all if omitted) |

## Recette : TESTE\_LOCAL

```text
/vulns
```

analyse des dépendances npm et détection des vulnérabilités connues.

Attendu : Analyse des dependances pour detecter les vulnerabilites de securite connues

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/vulns/terminal.txt)

## Invocation prévue

```text
/vulns
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Scan project dependencies for known security vulnerabilities
