# /companion-loops

Armer ou couper les boucles compagnon sans dépendre du serveur sensoriel.

Le handler existe (`handleCompanionLoops`, exporté du barrel).
Le token slash `__COMPANION_LOOPS__` n’est pas encore dans `enhanced-command-handler.ts`.
En pratique : `/heartbeat enable` ou `buddy heartbeat start`.

## Usage (handler)

```text
start | enable | on
stop  | disable | off
status
```

## Flags

| Variable | Effet |
| --- | --- |
| `CODEBUDDY_COMPANION_IMPULSE_DELIVER` | livre les impulsions (Telegram + historique) |
| `CODEBUDDY_COMPANION_PROACTIVE` | idem + boucle proactive |
| `CODEBUDDY_COMPANION_PRESENCE` | présence douce |
| `CODEBUDDY_COMPANION_IDLE` | travail seul, artifacts only |
| `CODEBUDDY_OPENCLAW_WORKSPACE_IMPORT` | SOUL/MEMORY/HEARTBEAT OpenClaw dans Lisa |

Hook serveur optionnel : `src/server/companion-boot.ts` → `wireCompanionServerLoops()`.
