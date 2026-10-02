# fleet-cli — recette du 2 octobre 2026

État : **Prérequis vérifiés**. Décision : **b+c** (a : défaut corrigé ; b : prérequis explicité ; c : promesse restreinte à la preuve).

status interroge un serveur ; le serveur absent doit être démarré séparément.

Message existant déjà actionnable : buddy server. Port dédié absent pour ne pas utiliser un service de l’hôte.

[Protocole, validation et limites](README.md).

## Avant

### fleet-cli-profiles

```text
$ buddy fleet profiles

Fleet dispatch profiles:

  balanced
    Policy: coding / confirm
    Use when: general delegation, mixed tasks, or unclear posture
    Balanced coding posture: edit files, confirm command/git-write/dangerous actions.
  research
    Policy: messaging / confirm
    Use when: source-aware investigation, context gathering, and low-mutation analysis
    Research posture: gather context broadly, avoid mutation and infrastructure changes.
  code
    Policy: coding / confirm
    Use when: implementation, refactoring, tests, and development edits
    Code posture: allow development edits, confirm execution and irreversible operations.
  review
    Policy: minimal / confirm
    Use when: read-first code review, audit, regression, and missing-test analysis
    Review posture: read-first, no code mutation, no runtime execution by default.
  safe
    Policy: minimal / deny
    Use when: high-risk, secret-bearing, destructive, or read-only-by-default work
    Safe posture: read-only by default, deny mutation and execution unless explicitly widened.


EXIT=0
```

### fleet-cli-policy

```text
$ buddy fleet policy

Fleet dispatch profile: balanced
  Policy profile: coding
  Default action: confirm
  Summary: Balanced coding posture: edit files, confirm command/git-write/dangerous actions.
  Allow groups: group:fs:read, group:fs:write, group:web, group:git:read, group:system:info
  Confirm groups: group:runtime:shell, group:git:write, group:fs:delete, group:mcp, group:plugin, group:dangerous
  Deny groups: none

Tool decisions:

  view_file: allow
    Groups: group:fs, group:fs:read
    Source: global
    Matched group: group:fs:read
    Reason: Fleet dispatch profile "balanced" allows group:fs:read
  create_file: allow
    Groups: group:fs, group:fs:write
    Source: global
    Matched group: group:fs:write
    Reason: Fleet dispatch profile "balanced" allows group:fs:write
  bash: confirm
    Groups: group:runtime, group:runtime:shell
    Source: global
    Matched group: group:runtime:shell
    Reason: Fleet dispatch profile "balanced" confirms group:runtime:shell
  git_push: confirm
    Groups: group:git, group:git:write, group:dangerous
    Source: global
    Matched group: group:git:write
    Reason: Fleet dispatch profile "balanced" confirms group:git:write
  web_search: allow
    Groups: group:web, group:web:search
    Source: global
    Matched group: group:web
    Reason: Fleet dispatch profile "balanced" allows group:web
  web_fetch: allow
    Groups: group:web, group:web:fetch
    Source: global
    Matched group: group:web
    Reason: Fleet dispatch profile "balanced" allows group:web
  delete_file: confirm
    Groups: group:fs, group:fs:delete, group:dangerous
    Source: global
    Matched group: group:fs:delete
    Reason: Fleet dispatch profile "balanced" confirms group:fs:delete


EXIT=0
```

### fleet-cli-status-isolated

```text
$ buddy fleet status --server-url http://127.0.0.1:39109
Fleet server unavailable at http://127.0.0.1:39109 (fetch failed). Start it with `buddy server`, then try again.

EXIT=1
```

## Après — paquet reconstruit et réinstallé

### fleet-cli-profiles

```text
$ buddy fleet profiles

Fleet dispatch profiles:

  balanced
    Policy: coding / confirm
    Use when: general delegation, mixed tasks, or unclear posture
    Balanced coding posture: edit files, confirm command/git-write/dangerous actions.
  research
    Policy: messaging / confirm
    Use when: source-aware investigation, context gathering, and low-mutation analysis
    Research posture: gather context broadly, avoid mutation and infrastructure changes.
  code
    Policy: coding / confirm
    Use when: implementation, refactoring, tests, and development edits
    Code posture: allow development edits, confirm execution and irreversible operations.
  review
    Policy: minimal / confirm
    Use when: read-first code review, audit, regression, and missing-test analysis
    Review posture: read-first, no code mutation, no runtime execution by default.
  safe
    Policy: minimal / deny
    Use when: high-risk, secret-bearing, destructive, or read-only-by-default work
    Safe posture: read-only by default, deny mutation and execution unless explicitly widened.


EXIT=0
```

### fleet-cli-policy

```text
$ buddy fleet policy

Fleet dispatch profile: balanced
  Policy profile: coding
  Default action: confirm
  Summary: Balanced coding posture: edit files, confirm command/git-write/dangerous actions.
  Allow groups: group:fs:read, group:fs:write, group:web, group:git:read, group:system:info
  Confirm groups: group:runtime:shell, group:git:write, group:fs:delete, group:mcp, group:plugin, group:dangerous
  Deny groups: none

Tool decisions:

  view_file: allow
    Groups: group:fs, group:fs:read
    Source: global
    Matched group: group:fs:read
    Reason: Fleet dispatch profile "balanced" allows group:fs:read
  create_file: allow
    Groups: group:fs, group:fs:write
    Source: global
    Matched group: group:fs:write
    Reason: Fleet dispatch profile "balanced" allows group:fs:write
  bash: confirm
    Groups: group:runtime, group:runtime:shell
    Source: global
    Matched group: group:runtime:shell
    Reason: Fleet dispatch profile "balanced" confirms group:runtime:shell
  git_push: confirm
    Groups: group:git, group:git:write, group:dangerous
    Source: global
    Matched group: group:git:write
    Reason: Fleet dispatch profile "balanced" confirms group:git:write
  web_search: allow
    Groups: group:web, group:web:search
    Source: global
    Matched group: group:web
    Reason: Fleet dispatch profile "balanced" allows group:web
  web_fetch: allow
    Groups: group:web, group:web:fetch
    Source: global
    Matched group: group:web
    Reason: Fleet dispatch profile "balanced" allows group:web
  delete_file: confirm
    Groups: group:fs, group:fs:delete, group:dangerous
    Source: global
    Matched group: group:fs:delete
    Reason: Fleet dispatch profile "balanced" confirms group:fs:delete


EXIT=0
```

### fleet-cli-status-isolated

```text
$ buddy fleet status --server-url http://127.0.0.1:39109
Fleet server unavailable at http://127.0.0.1:39109 (fetch failed). Start it with `buddy server`, then try again.

EXIT=1
```
