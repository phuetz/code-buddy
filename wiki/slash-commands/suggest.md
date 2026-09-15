# /suggest

[Accueil](Home.md) · [Wiki interactif](index.html#suggest)

Demander des suggestions liées au projet.

## Syntaxe du catalogue

```text
/suggest [category]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| category | Non | all, code, perf, security, git, testing, docs, workflow |

## Recette : TESTE\_LOCAL

```text
/suggest all
```

/suggest all (analyse du projet et génération de 8 suggestions proactives).

Attendu : Generation de suggestions proactives par le modele sur le projet

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/suggest/terminal.txt)

## Invocation prévue

```text
/suggest all
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Get proactive suggestions for the current project context
