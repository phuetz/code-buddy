# /agents

[Accueil](Home.md) · [Wiki interactif](index.html#agents)

Piloter l’orchestration multi-agent.

## Syntaxe du catalogue

```text
/agents [action]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| action | Non | enable \| disable \| status \| run \<goal\> \| plan \<goal\> \| stop \| strategy \<name\> |

## Recette : TESTE\_LOCAL

```text
/agents status
```

/agents status (consultation de l'état inactif du système multi-agents).

Attendu : Statut de l'orchestration multi-agents

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/agents/terminal.txt)

## Invocation prévue

```text
/agents status
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Multi-agent orchestration (run/plan/status/stop/strategy) — 4 specialised agents (orchestrator/coder/reviewer/tester), 5 strategies. Requires GROK\_API\_KEY.
