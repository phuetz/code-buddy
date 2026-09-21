# /companion-loops

Armer ou couper les boucles compagnon (livraison d'impulsions) sans dépendre du serveur sensoriel.

## Usage

```text
/companion-loops start
/companion-loops stop
/companion-loops status
```

Le mapping slash `__COMPANION_LOOPS__` n'est pas encore dans `enhanced-command-handler.ts`.
En attendant : `/heartbeat enable` appelle `startCompanionAlwaysOnLoops()`.

Variables :

- `CODEBUDDY_COMPANION_PROACTIVE=true`
- `CODEBUDDY_COMPANION_IMPULSE_DELIVER=true`
