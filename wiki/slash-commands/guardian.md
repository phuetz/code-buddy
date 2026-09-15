# /guardian

[Accueil](Home.md) · [Wiki interactif](index.html#guardian)

Activer Code Guardian pour une analyse du code.

## Syntaxe du catalogue

```text
/guardian [action] [mode]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| action | Non | analyze \<path\>, security, review, refactor, plan, architecture |
| mode | Non | Mode: analyze-only, suggest, plan, diff |

## Recette : TESTE\_LOCAL

```text
/guardian security
```

analyse de sécurité du code via Code Guardian.

Attendu : Activation de Code Guardian pour l'analyse de securite du code

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/guardian/terminal.txt)

## Invocation prévue

```text
/guardian security
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Activate Code Guardian for code analysis and review
