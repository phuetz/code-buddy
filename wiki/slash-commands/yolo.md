# /yolo

[Accueil](Home.md) · [Wiki interactif](index.html#yolo)

Configurer l’exécution automatique avec garde-fous.

## Syntaxe du catalogue

```text
/yolo [action]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| action | Non | on, off, safe, status, allow, deny |

## Recette : TESTE\_LOCAL

```text
/yolo status
```

affichage du statut d'activation du mode YOLO et des garde-fous.

Attendu : Affichage du statut d'activation du mode YOLO et des garde-fous

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/yolo/terminal.txt)

## Invocation prévue

```text
/yolo status
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Toggle YOLO mode (full auto-execution with guardrails)
