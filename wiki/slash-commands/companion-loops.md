# /companion-loops

[Accueil](Home.md) · [Wiki interactif](index.html#companion-loops)

Armer ou couper les boucles compagnon sans dépendre du serveur sensoriel.

Le handler existe (`handleCompanionLoops`, exporté du barrel).

Si le token `__COMPANION_LOOPS__` n’apparaît pas encore dans `enhanced-command-handler.ts`
sur ton clone, `git pull` puis cherche `handleCompanionLoops`.
Sinon : `/heartbeat enable` ou `buddy heartbeat start` arme les mêmes boucles.

## Usage (handler)

```text
/companion-loops start
/companion-loops stop
/companion-loops status
```

Flags :

| Variable | Effet |
| --- | --- |
| `CODEBUDDY_COMPANION_IMPULSE_DELIVER` | envoie les impulsions |
| `CODEBUDDY_COMPANION_PRESENCE` | présence |
| `CODEBUDDY_COMPANION_PROACTIVE` | messages proactifs |
| `CODEBUDDY_COMPANION_IDLE` | travail seul, artifacts only |
| `CODEBUDDY_OPENCLAW_WORKSPACE_IMPORT` | SOUL/MEMORY/HEARTBEAT OpenClaw dans Lisa |
