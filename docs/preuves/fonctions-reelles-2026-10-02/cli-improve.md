# cli-improve — recette du 2 octobre 2026

État : **Partiellement vérifiée**. Décision : **c** (a : défaut corrigé ; b : prérequis explicité ; c : promesse restreinte à la preuve).

status inspecte la configuration ; il ne lance aucune expérience.

Corriger la promesse associée à la commande réellement éprouvée ; aucun gain empirique conclu de status.

[Protocole, validation et limites](README.md).

## Avant

### cli-improve

```text
$ buddy improve status --json
{
  "kind": "self_improvement_status",
  "autonomy": "propose-only",
  "score": {
    "total": 15,
    "covered": 0,
    "ratio": 0,
    "results": [
      {
        "scenarioId": "npm-test-path-filter",
        "covered": false,
        "matchedLessonIds": []
      },
      {
        "scenarioId": "esm-js-extension-imports",
        "covered": false,
        "matchedLessonIds": []
      },
      {
        "scenarioId": "logger-not-console",
        "covered": false,
        "matchedLessonIds": []
      },
      {
        "scenarioId": "atomic-write-state",
        "covered": false,
        "matchedLessonIds": []
      },
      {
        "scenarioId": "git-add-named-files",
        "covered": false,
        "matchedLessonIds": []
      },
      {
        "scenarioId": "subproc-bounded-timeout",
        "covered": false,
        "matchedLessonIds": []
      },
      {
        "scenarioId": "no-secrets-in-repo",
        "covered": false,
        "matchedLessonIds": []
      },
      {
        "scenarioId": "isolated-home-tests",
        "covered": false,
        "matchedLessonIds": []
      },
      {
        "scenarioId": "str-replace-omission-block",
        "covered": false,
        "matchedLessonIds": []
      },
      {
        "scenarioId": "verify-before-finishing",
        "covered": false,
        "matchedLessonIds": []
      },
      {
        "scenarioId": "report-before-inspection",
        "covered": false,
        "matchedLessonIds": []
      },
      {
        "scenarioId": "tests-live-in-tests-only",
        "covered": false,
        "matchedLessonIds": []
      },
      {
        "scenarioId": "self-improvement-never-touch-src",
        "covered": false,
        "matchedLessonIds": []
      },
      {
        "scenarioId": "peer-tool-fails-closed",
        "covered": false,
        "matchedLessonIds": []
      },
      {
        "scenarioId": "batch-anti-tautology-guard",
        "covered": false,
        "matchedLessonIds": []
      }
    ]
  },
  "archive": {
    "count": 0,
    "totalDelta": 0,
    "lastAt": null
  },
  "store": {
    "head": null,
    "best": null,
    "versions": 0
  }
}

EXIT=0
```

## Après — paquet reconstruit et réinstallé

### cli-improve

```text
$ buddy improve status --json
{
  "kind": "self_improvement_status",
  "autonomy": "propose-only",
  "score": {
    "total": 15,
    "covered": 0,
    "ratio": 0,
    "results": [
      {
        "scenarioId": "npm-test-path-filter",
        "covered": false,
        "matchedLessonIds": []
      },
      {
        "scenarioId": "esm-js-extension-imports",
        "covered": false,
        "matchedLessonIds": []
      },
      {
        "scenarioId": "logger-not-console",
        "covered": false,
        "matchedLessonIds": []
      },
      {
        "scenarioId": "atomic-write-state",
        "covered": false,
        "matchedLessonIds": []
      },
      {
        "scenarioId": "git-add-named-files",
        "covered": false,
        "matchedLessonIds": []
      },
      {
        "scenarioId": "subproc-bounded-timeout",
        "covered": false,
        "matchedLessonIds": []
      },
      {
        "scenarioId": "no-secrets-in-repo",
        "covered": false,
        "matchedLessonIds": []
      },
      {
        "scenarioId": "isolated-home-tests",
        "covered": false,
        "matchedLessonIds": []
      },
      {
        "scenarioId": "str-replace-omission-block",
        "covered": false,
        "matchedLessonIds": []
      },
      {
        "scenarioId": "verify-before-finishing",
        "covered": false,
        "matchedLessonIds": []
      },
      {
        "scenarioId": "report-before-inspection",
        "covered": false,
        "matchedLessonIds": []
      },
      {
        "scenarioId": "tests-live-in-tests-only",
        "covered": false,
        "matchedLessonIds": []
      },
      {
        "scenarioId": "self-improvement-never-touch-src",
        "covered": false,
        "matchedLessonIds": []
      },
      {
        "scenarioId": "peer-tool-fails-closed",
        "covered": false,
        "matchedLessonIds": []
      },
      {
        "scenarioId": "batch-anti-tautology-guard",
        "covered": false,
        "matchedLessonIds": []
      }
    ]
  },
  "archive": {
    "count": 0,
    "totalDelta": 0,
    "lastAt": null
  },
  "store": {
    "head": null,
    "best": null,
    "versions": 0
  }
}

EXIT=0
```
