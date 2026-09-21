# /heartbeat

[Accueil](Home.md) · [Wiki interactif](index.html#heartbeat)

Gérer la revue périodique de HEARTBEAT.md et armer les boucles compagnon.

## Syntaxe du catalogue

```text
/heartbeat [action]
```

| Argument | Obligatoire | Description du catalogue |
| --- | --- | --- |
| action | Non | enable \| disable \| status (default: status) |

`enable` démarre le moteur **et** `startCompanionAlwaysOnLoops()`.
`disable` arrête les deux.

Guide : [docs/heartbeat.md](../../docs/heartbeat.md).
Exemple : [docs/examples/HEARTBEAT.md](../../docs/examples/HEARTBEAT.md).

## Recette : TESTE_LOCAL

```text
/heartbeat status
```

Attendu : Statut du moteur de heartbeat.

[Capture locale](../../../../Videos/Partage/20260914-commandes-wiki/cases/heartbeat/terminal.txt)

## Invocation prévue

```text
/heartbeat status
```

## Limites

Le verdict porte sur l’invocation capturée, pas sur toutes les sous-commandes.

Description d’origine du catalogue : Manage the heartbeat engine (enable/disable/status) — periodic HEARTBEAT.md review
