# dgm-authored-tools — recette du 2 octobre 2026

État : **Partiellement vérifiée**. Décision : **c** (a : défaut corrigé ; b : prérequis explicité ; c : promesse restreinte à la preuve).

Sans proposition disponible, improve tools ne peut évaluer un outil.

Expliciter le cas vide selectedScenarioId:null, proposalId:null, applied:false.

[Protocole, validation et limites](README.md).

## Avant

### dgm-authored-tools

```text
$ buddy improve tools --json
{
  "kind": "self_improvement_tools",
  "cycles": [
    {
      "kind": "tool_improvement_cycle",
      "startedAt": "2026-10-02T14:04:49.771Z",
      "autonomy": "propose-only",
      "selectedScenarioId": null,
      "proposalId": null,
      "gate": null,
      "applied": false,
      "notes": [
        "no uncovered tool scenario with an available proposal"
      ]
    }
  ]
}

EXIT=0
```

## Après — paquet reconstruit et réinstallé

### dgm-authored-tools

```text
$ buddy improve tools --json
{
  "kind": "self_improvement_tools",
  "cycles": [
    {
      "kind": "tool_improvement_cycle",
      "startedAt": "2026-10-02T14:35:11.780Z",
      "autonomy": "propose-only",
      "selectedScenarioId": null,
      "proposalId": null,
      "gate": null,
      "applied": false,
      "notes": [
        "no uncovered tool scenario with an available proposal"
      ]
    }
  ]
}

EXIT=0
```
