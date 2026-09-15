# /infra

[Accueil](Home.md) · [Wiki interactif](index.html#infra)

Consulter l’état des services d’infrastructure.

## Syntaxe du catalogue

```text
/infra [subcommand]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| subcommand | Non | status (default), stats, health |

## Recette : ECHEC

```text
/infra status
```

Aucun tableau de bord ni réponse après /infra status, malgré 60 secondes d’attente.

Attendu : Tableau de bord de sante des infrastructures d'inference

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/replays-async/cases/infra/terminal.txt)

## Invocation prévue

```text
/infra status
```

Cette invocation vient du plan ; sa présence ne prouve pas son exécution.

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes. Une aide affichée ne valide pas une connexion, une modification, ni un appel IA. Les résultats Linux ne prouvent pas le fonctionnement Windows. Sans preuve, la commande reste NON_TESTE.



Description d’origine du catalogue : Show infrastructure health dashboard (Ollama, vLLM, TurboQuant routing stats)
