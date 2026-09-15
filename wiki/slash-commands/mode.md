# /mode

[Accueil](Home.md) · [Wiki interactif](index.html#mode)

Changer le mode de travail de l’agent.

## Syntaxe du catalogue

```text
/mode <mode>
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| mode | Oui | Mode to switch to: plan, code, or ask |

## Recette : TESTE\_LOCAL

```text
/mode ask
```

basculement effectif du mode de l'agent vers ask.

Attendu : Changement du mode de l'agent vers ask

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/mode/terminal.txt)

## Invocation prévue

```text
/mode ask
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Change agent mode (plan/code/ask)
