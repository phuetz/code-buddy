# cli-daemon — recette du 2 octobre 2026

État : **Partiellement vérifiée**. Décision : **c** (a : défaut corrigé ; b : prérequis explicité ; c : promesse restreinte à la preuve).

status suit le PID ; les détails de santé des sous-services ne sont pas remontés par ce gestionnaire.

Démarrage, santé degraded après attente et arrêt prouvés. status --json déclare les détails de service indisponibles ; pas de supervision complète revendiquée.

[Protocole, validation et limites](README.md).

## Avant

### cli-daemon-start-wait

```text
$ buddy daemon start --port 39103
[2026-10-02T14:17:36.972Z]  INFO  Daemon started (PID: 15)
Daemon started (PID: 15)

EXIT=0
```

### cli-daemon-status-json

```text
$ buddy daemon status --json
{
  "kind": "codebuddy_daemon_status",
  "schemaVersion": 1,
  "generatedAt": "2026-10-02T14:17:38.886Z",
  "status": {
    "running": true,
    "pid": 15,
    "uptimeMs": null,
    "uptimeSeconds": null,
    "startedAt": null,
    "restartCount": 0,
    "services": []
  },
  "summary": {
    "serviceCount": 0,
    "runningServiceCount": 0,
    "stoppedServiceCount": 0
  },
  "recommendations": [
    "Daemon is running, but no service health details are currently reported."
  ]
}

EXIT=0
```

### cli-daemon-health-wait

```text
{
  "status": "degraded",
  "version": "2.3.0",
  "checks": {
    "database": "ok",
    "api": "unknown",
    "memory": "ok"
  },
  "apiHeartbeat": {
    "lastCheck": null,
    "latencyMs": null,
    "status": "unknown"
  }
}
```

### cli-daemon-stop-wait

```text
$ buddy daemon stop
[2026-10-02T14:17:39.425Z]  INFO  Daemon stopped (PID: 15)
Daemon stopped

EXIT=0
```

## Après — paquet reconstruit et réinstallé

### cli-daemon-start-wait

```text
$ buddy daemon start --port 39103
[2026-10-02T14:35:27.757Z]  INFO  Daemon started (PID: 1639)
Daemon started (PID: 1639)

EXIT=0
```

### cli-daemon-status-json

```text
$ buddy daemon status --json
{
  "kind": "codebuddy_daemon_status",
  "schemaVersion": 1,
  "generatedAt": "2026-10-02T14:35:29.645Z",
  "status": {
    "running": true,
    "pid": 1639,
    "uptimeMs": null,
    "uptimeSeconds": null,
    "startedAt": null,
    "restartCount": 0,
    "services": []
  },
  "summary": {
    "serviceCount": 0,
    "runningServiceCount": 0,
    "stoppedServiceCount": 0
  },
  "recommendations": [
    "Daemon is running, but no service health details are currently reported."
  ]
}

EXIT=0
```

### cli-daemon-health-wait

```text
{
  "status": "degraded",
  "version": "2.3.0",
  "checks": {
    "database": "ok",
    "api": "unknown",
    "memory": "ok"
  },
  "apiHeartbeat": {
    "lastCheck": null,
    "latencyMs": null,
    "status": "unknown"
  }
}
```

### cli-daemon-stop-wait

```text
$ buddy daemon stop
[2026-10-02T14:35:30.063Z]  INFO  Daemon stopped (PID: 1639)
Daemon stopped

EXIT=0
```
