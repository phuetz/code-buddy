# /config

[Accueil](Home.md) · [Wiki interactif](index.html#config)

Consulter et valider la configuration.

## Syntaxe du catalogue

```text
/config [action]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| action | Non | validate, show, defaults \<schema\>, docs \<schema\> |

## Recette : TESTE\_LOCAL

```text
/config validate
```

validation des fichiers de configuration et des variables d'environnement.

Attendu : Rapport de validation des fichiers de configuration et variables d'environnement

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/config/terminal.txt)

## Invocation prévue

```text
/config validate
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Validate configuration files and environment variables
