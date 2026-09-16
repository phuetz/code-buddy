# /swarm

[Accueil](Home.md) · [Wiki interactif](index.html#swarm)

Faire travailler plusieurs agents spécialisés sur une tâche.

## Syntaxe du catalogue

```text
/swarm [task]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| task | Non | task description, OR: stop \| status \| help |

## Recette : TESTE\_LOCAL

```text
/swarm status
```

/swarm status (état inactif du système multi-agents).

Attendu : Statut de l'essaim d'agents

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/swarm/terminal.txt)

## Invocation prévue

```text
/swarm status
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Spawn a swarm of specialized agents to work in parallel on a task (UX wrapper around /agents run with strategy=parallel; inspired by Korben's Claude Code Swarms article)
