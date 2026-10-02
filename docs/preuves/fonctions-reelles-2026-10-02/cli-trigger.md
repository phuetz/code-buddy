# cli-trigger — recette du 2 octobre 2026

État : **Partiellement vérifiée**. Décision : **b+c** (a : défaut corrigé ; b : prérequis explicité ; c : promesse restreinte à la preuve).

CRUD seul ne prouve ni arrivée d’un événement réel ni réponse d’agent.

CRUD réel et événement synthétique évalué (fireCount:1) ; aucune surveillance de fichier bout en bout ni réponse modèle revendiquée.

[Protocole, validation et limites](README.md).

## Avant

### cli-trigger-add-event

```text
$ buddy trigger add file_change:README notify:cli
Trigger created: c182c2b6 (file_change: README)

EXIT=0
```

### cli-trigger-event

```text
trigger:fired [{"trigger":{"id":"c182c2b6-9541-4395-921a-358fe7e10ef8","name":"file_change trigger","type":"file_change","condition":"README","action":{"type":"notify","target":"cli"},"cooldownMs":5000,"enabled":true,"createdAt":"2026-10-02T14:17:05.886Z","fireCount":1,"lastFiredAt":"2026-10-02T14:17:05.966Z"},"event":{"triggerId":"qa-event","type":"file_change","data":{"path":"README"},"timestamp":"2026-10-02T14:17:05.966Z"}}]
{"syntheticEvent":true,"fired":[{"name":"file_change trigger","fireCount":1,"action":{"type":"notify","target":"cli"}}]}
```

### cli-trigger-remove-event

```text
$ buddy trigger remove c182c2b6
Trigger removed: c182c2b6

EXIT=0
```

## Après — paquet reconstruit et réinstallé

### cli-trigger-add-event

```text
$ buddy trigger add file_change:README notify:cli
Trigger created: f36856c3 (file_change: README)

EXIT=0
```

### cli-trigger-event

```text
$ node fixtures.mjs trigger
trigger:fired [{"trigger":{"id":"f36856c3-b396-47ae-94dc-b197c43a9ca1","name":"file_change trigger","type":"file_change","condition":"README","action":{"type":"notify","target":"cli"},"cooldownMs":5000,"enabled":true,"createdAt":"2026-10-02T14:35:26.394Z","fireCount":1,"lastFiredAt":"2026-10-02T14:35:26.747Z"},"event":{"triggerId":"qa-event","type":"file_change","data":{"path":"README"},"timestamp":"2026-10-02T14:35:26.746Z"}}]
{"syntheticEvent":true,"fired":[{"name":"file_change trigger","fireCount":1,"action":{"type":"notify","target":"cli"}}]}

EXIT=0
```

### cli-trigger-remove-event

```text
$ buddy trigger remove f36856c3
Trigger removed: f36856c3

EXIT=0
```
