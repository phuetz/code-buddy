# cli-run — recette du 2 octobre 2026

État : **Partiellement vérifiée**. Décision : **c** (a : défaut corrigé ; b : prérequis explicité ; c : promesse restreinte à la preuve).

Un run sans appel d’outil n’offre aucun événement rejouable.

List/show/replay réels sur un run bloqué : 0 outil, message No replayable tool events. Aucun rejeu réussi revendiqué.

[Protocole, validation et limites](README.md).

## Avant

### cli-run-list

```text
$ buddy run list

Recent runs (1)

  [FAIL] run_mur1bh17_9b2771  2026-10-02 14:04:41  (427ms)  Add a one-line note to README


EXIT=0
```

### cli-run-show

```text
$ buddy run show run_mur1bh17_9b2771

Run: run_mur1bh17_9b2771
Status: [FAIL]
Objective: Add a one-line note to README
Started: 2026-10-02 14:04:41
Ended:   2026-10-02 14:04:42 (427ms)

── Metrics ─────────────────────────────
  Duration:    427ms
  Tokens:      0
  Cost:        $0.000000
  Tool calls:  0

── Artifacts ───────────────────────────
  agentic-coding-report.json
  learning-retrospective.json
  learning-retrospective.md
  workflow-progress.json

── Timeline ────────────────────────────
  [>] +0.00s  run_start      objective="Add a one-line note to README"
  [D] +0.01s  decision
  [+] +0.01s  step_start
  [-] +0.01s  step_end
  [+] +0.02s  step_start
  [-] +0.36s  step_end
  [+] +0.36s  step_start
  [-] +0.36s  step_end
  [+] +0.36s  step_start
  [-] +0.38s  step_end
  [P] +0.42s  patch_created  artifact=agentic-coding-report.json
  [P] +0.43s  patch_created  artifact=workflow-progress.json
  [D] +0.43s  decision
  [=] +0.43s  run_end        status=failed


EXIT=0
```

### cli-run-replay

```text
$ buddy run replay run_mur1bh17_9b2771

Run: run_mur1bh17_9b2771
Status: [FAIL]
Objective: Add a one-line note to README
Started: 2026-10-02 14:04:41
Ended:   2026-10-02 14:04:42 (427ms)

── Metrics ─────────────────────────────
  Duration:    427ms
  Tokens:      0
  Cost:        $0.000000
  Tool calls:  0

── Artifacts ───────────────────────────
  agentic-coding-report.json
  learning-retrospective.json
  learning-retrospective.md
  workflow-progress.json

── Timeline ────────────────────────────
  [>] +0.00s  run_start      objective="Add a one-line note to README"
  [D] +0.01s  decision
  [+] +0.01s  step_start
  [-] +0.01s  step_end
  [+] +0.02s  step_start
  [-] +0.36s  step_end
  [+] +0.36s  step_start
  [-] +0.36s  step_end
  [+] +0.36s  step_start
  [-] +0.38s  step_end
  [P] +0.42s  patch_created  artifact=agentic-coding-report.json
  [P] +0.43s  patch_created  artifact=workflow-progress.json
  [D] +0.43s  decision
  [=] +0.43s  run_end        status=failed

No replayable tool events found in this run.

EXIT=0
```

## Après — paquet reconstruit et réinstallé

### cli-run-list

```text
$ buddy run list

Recent runs (1)

  [FAIL] run_mur2eksg_f20f97  2026-10-02 14:35:06  (563ms)  Add a one-line note to README


EXIT=0
```

### cli-run-show

```text
$ buddy run show run_mur2eksg_f20f97

Run: run_mur2eksg_f20f97
Status: [FAIL]
Objective: Add a one-line note to README
Started: 2026-10-02 14:35:06
Ended:   2026-10-02 14:35:06 (563ms)

── Metrics ─────────────────────────────
  Duration:    563ms
  Tokens:      0
  Cost:        $0.000000
  Tool calls:  0

── Artifacts ───────────────────────────
  agentic-coding-report.json
  learning-retrospective.json
  learning-retrospective.md
  workflow-progress.json

── Timeline ────────────────────────────
  [>] +0.00s  run_start      objective="Add a one-line note to README"
  [D] +0.01s  decision
  [+] +0.01s  step_start
  [-] +0.01s  step_end
  [+] +0.01s  step_start
  [-] +0.51s  step_end
  [+] +0.51s  step_start
  [-] +0.51s  step_end
  [+] +0.51s  step_start
  [-] +0.53s  step_end
  [P] +0.56s  patch_created  artifact=agentic-coding-report.json
  [P] +0.56s  patch_created  artifact=workflow-progress.json
  [D] +0.56s  decision
  [=] +0.56s  run_end        status=failed


EXIT=0
```

### cli-run-replay

```text
$ buddy run replay run_mur2eksg_f20f97

Run: run_mur2eksg_f20f97
Status: [FAIL]
Objective: Add a one-line note to README
Started: 2026-10-02 14:35:06
Ended:   2026-10-02 14:35:06 (563ms)

── Metrics ─────────────────────────────
  Duration:    563ms
  Tokens:      0
  Cost:        $0.000000
  Tool calls:  0

── Artifacts ───────────────────────────
  agentic-coding-report.json
  learning-retrospective.json
  learning-retrospective.md
  workflow-progress.json

── Timeline ────────────────────────────
  [>] +0.00s  run_start      objective="Add a one-line note to README"
  [D] +0.01s  decision
  [+] +0.01s  step_start
  [-] +0.01s  step_end
  [+] +0.01s  step_start
  [-] +0.51s  step_end
  [+] +0.51s  step_start
  [-] +0.51s  step_end
  [+] +0.51s  step_start
  [-] +0.53s  step_end
  [P] +0.56s  patch_created  artifact=agentic-coding-report.json
  [P] +0.56s  patch_created  artifact=workflow-progress.json
  [D] +0.56s  decision
  [=] +0.56s  run_end        status=failed

No replayable tool events found in this run.

EXIT=0
```
