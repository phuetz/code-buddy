# /export

[Accueil](Home.md) · [Wiki interactif](index.html#export)

Exporter une session.

## Syntaxe du catalogue

```text
/export [format] [session]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| format | Non | Export format: json, markdown, html, text (default: markdown) |
| session | Non | session:\<id\> to export specific session |

## Recette : ECHEC

```text
/export markdown
```

exportation de la session active interrompue par une erreur interne de base de données.

Attendu : Exportation de la session active au format markdown

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/export/terminal.txt)

## Invocation prévue

```text
/export markdown
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Export session to various formats (JSON, Markdown, HTML, Text)
