# /subagent

[Accueil](Home.md) · [Wiki interactif](index.html#subagent)

Découvrir les sous-agents conversationnels prédéfinis.

## Syntaxe du catalogue

```text
/subagent [action]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| action | Non | list (default), info \<name\>, help |

## Recette : TESTE\_LOCAL

```text
/subagent list
```

/subagent list (inventaire des 7 sous-agents prédéfinis).

Attendu : Liste des sous-agents predefinis

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/subagent/terminal.txt)

## Invocation prévue

```text
/subagent list
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : List and inspect predefined conversational subagents (Explore, code-reviewer, debugger, etc.) — read-only discovery, complements /agent (custom) and /agents (MultiAgentSystem)
