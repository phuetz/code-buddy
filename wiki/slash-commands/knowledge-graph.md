# /knowledge-graph

[Accueil](Home.md) · [Wiki interactif](index.html#knowledge-graph)

Consulter le graphe de connaissances persistant.

## Syntaxe du catalogue

```text
/knowledge-graph [action]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| action | Non | stats, entities, recall \<query\> |

## Recette : BLOQUE\_PREREQUIS

```text
/knowledge-graph stats
```

contrôle du prérequis d'activation de la variable d'environnement CODEBUDDY\_COLLECTIVE\_MEMORY.

Attendu : Affichage des statistiques du graphe de connaissances persistant

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/knowledge-graph/terminal.txt)

## Invocation prévue

```text
/knowledge-graph stats
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : View persistent knowledge graph stats and recall (requires CODEBUDDY\_COLLECTIVE\_MEMORY=true)
