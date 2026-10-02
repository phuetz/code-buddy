# cli-device — recette du 2 octobre 2026

État : **Partiellement vérifiée**. Décision : **b+c** (a : défaut corrigé ; b : prérequis explicité ; c : promesse restreinte à la preuve).

Seul le transport local est disponible dans cette recette.

Transport local prouvé avec marqueur CB_DEVICE_OK ; aucune validation SSH/ADB revendiquée.

[Protocole, validation et limites](README.md).

## Avant

### cli-device-pair

```text
$ buddy device pair --id qa-local --name QA local --transport local
[2026-10-02T14:04:47.515Z]  INFO  Pairing device: QA local (qa-local) via local
[2026-10-02T14:04:47.517Z]  INFO  Local transport connected
[2026-10-02T14:04:47.539Z]  INFO  Device paired with capabilities: system_run, camera, screen_record {"id":"qa-local","name":"QA local"}
Device paired: QA local (qa-local)
  Type: local
  Transport: local
  Capabilities: system_run, camera, screen_record

EXIT=0
```

### cli-device-run

```text
$ buddy device run qa-local printf CB_DEVICE_OK
[2026-10-02T14:04:47.760Z]  INFO  Local transport connected
CB_DEVICE_OK

EXIT=0
```

### cli-device-remove

```text
$ buddy device remove qa-local
[2026-10-02T14:04:47.990Z]  INFO  Unpairing device: qa-local
Device qa-local removed

EXIT=0
```

## Après — paquet reconstruit et réinstallé

### cli-device-pair

```text
$ buddy device pair --id qa-local --name QA local --transport local
[2026-10-02T14:35:10.352Z]  INFO  Pairing device: QA local (qa-local) via local
[2026-10-02T14:35:10.354Z]  INFO  Local transport connected
[2026-10-02T14:35:10.367Z]  INFO  Device paired with capabilities: system_run, camera, screen_record {"id":"qa-local","name":"QA local"}
Device paired: QA local (qa-local)
  Type: local
  Transport: local
  Capabilities: system_run, camera, screen_record

EXIT=0
```

### cli-device-run

```text
$ buddy device run qa-local printf CB_DEVICE_OK
[2026-10-02T14:35:10.528Z]  INFO  Local transport connected
CB_DEVICE_OK

EXIT=0
```

### cli-device-remove

```text
$ buddy device remove qa-local
[2026-10-02T14:35:10.675Z]  INFO  Unpairing device: qa-local
Device qa-local removed

EXIT=0
```
