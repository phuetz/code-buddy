# Réparation SANDBOX1 — bac à sable natif (Landlock / Bubblewrap)

Clone : `/home/patrice/DEV/cb-sandbox1-2026-09-03`
Branche : `feat/sandbox1-native-sandbox-2026-09-03` (`61fd3d17c`)
Agent : Grok 4.6
Date : 2026-09-03
HOME temporaire : `_qa/sandbox1/` (dans le clone uniquement)
Original `~/code-buddy` : interdit en écriture

Ce rapport a été créé **avant toute inspection du code**.

## Capacités noyau (mesurées AVANT tout code)

```
$ command -v bwrap
/usr/bin/bwrap

$ bwrap --version
bubblewrap 0.9.0

$ uname -r
6.17.0-1032-oem

$ grep -c landlock /proc/kallsyms
113

$ command -v sandbox-exec
(exit 1 — absent, attendu sous Linux)

$ cat /proc/sys/kernel/unprivileged_userns_clone
1

$ cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns
1
```

`bwrap` existe, mais un probe réel échoue :

```
bwrap --unshare-user --die-with-parent --ro-bind / / --dev /dev --proc /proc /bin/true
bwrap: setting up uid map: Permission denied
```

`--unshare-net` / `--unshare-all` échouent avec `loopback: Failed RTM_NEWADDR: Operation not permitted`.

Landlock ABI (ctypes, syscall 444) : **7**, `landlock_restrict_self` réussit.

Décision : ne pas livrer une fonctionnalité morte qui suppose un `bwrap` utilisable. Builder argv Bubblewrap conservé et testé. Runtime Linux ici = **Landlock** (python3 stdlib, pas de nouvelle dépendance npm). `CODEBUDDY_NATIVE_SANDBOX=bwrap` refuse au lieu d'exécuter en clair.

## Rouge avant correctif

```
npx vitest run tests/security/native-sandbox.test.ts
FAIL  tests/security/native-sandbox.test.ts
Error: Cannot find module '../../src/security/native-sandbox.js'
Test Files  1 failed (1)
Tests       no tests
```

## Livré

- `src/security/native-sandbox.ts` — détection injectable, builders argv purs (`bwrap` / Landlock / seatbelt), `confineSpawn`.
- `src/security/landlock-confine.py` — applique le ruleset puis `exec` (lecture projet, écriture projet+TMPDIR, pas `/etc` ni `~/.ssh` ni `~/.codebuddy`, TCP coupé).
- `src/tools/bash/bash-tool.ts` + `streaming-executor.ts` — confinement **après** confirmation, **avant** spawn. Gardes existantes intactes.
- `buddy doctor` : une ligne `Native sandbox (kernel)`.
- Opt-in `CODEBUDDY_NATIVE_SANDBOX` (absent ⇒ argv d'origine, aucune sonde).

## Preuves d'exécution réelle (Landlock, clone)

`CODEBUDDY_NATIVE_SANDBOX=true` ; backend `landlock` ; python `/home/patrice/miniforge3/bin/python3`.

### 1. `echo ok` — réussit

```
===== echo ok =====
backend=landlock file=/home/patrice/miniforge3/bin/python3
status=0
stdout="ok\n"
stderr=""
```

### 2. lecture `~/.ssh` / `~/.codebuddy` — échoue

```
===== read ~/.ssh =====
backend=landlock
status=0
stdout="SSH_EXIT=2\n"
stderr="ls: cannot open directory '/home/patrice/.ssh': Permission denied\n"

===== ls ~/.codebuddy =====
stderr="ls: cannot open directory '/home/patrice/.codebuddy': Permission denied\n"
```

Aucun JSON de `~/.codebuddy` lu. Le vrai `~/.codebuddy` n'a pas été écrit.

### 3. écriture hors projet — échoue

```
===== write /tmp =====
stdout="TMP_EXIT=1\n"
stderr="/usr/bin/bash: line 1: /tmp/cb-sandbox1-write-probe-2785149: Permission denied\n"

===== write $HOME =====
stdout="HOME_EXIT=1\n"
stderr="/usr/bin/bash: line 1: /home/patrice/cb-sandbox1-home-probe-2785151: Permission denied\n"
```

`ls /tmp/cb-sandbox1-write-probe-*` et `ls /home/patrice/cb-sandbox1-home-probe-*` : aucun fichier.

Écriture dans le TMPDIR dédié du projet : `confined-ok`.

### 4. réseau coupé — `curl` échoue

```
===== curl network =====
status=6
stdout="http=000\n"
stderr="curl: (6) Could not resolve host: example.com\n"
```

(`/etc` n'est pas monté en lecture ; Landlock ABI 5+ gère aussi `CONNECT_TCP` sans règle d'autorisation.)

### Fail-closed `bwrap` (binaire présent, confinement impossible)

```
CODEBUDDY_NATIVE_SANDBOX=bwrap
{
  ok: false,
  error: 'CODEBUDDY_NATIVE_SANDBOX is set, but kernel confinement cannot be applied: bubblewrap is present but unusable (bwrap: setting up uid map: Permission denied). The command was not executed.'
}
```

Variable absente : `{ ok: true, file: "echo", args: ["ok"], backend: "none" }`.

## Vérifications

| Commande | Résultat |
|---|---|
| `npx vitest run tests/security` | 44 fichiers / 848 verts |
| `npx vitest run tests/tools/bash` | 5 fichiers / 164 verts |
| union `tests/security tests/tools/bash` | 49 fichiers / 1012 verts |
| `npx vitest run tests/security/donnees-personnelles.test.ts` | 1/1 vert |
| `npx tsc --noEmit -p .` | code 0 |
| `npx eslint <fichiers modifiés> --max-warnings=0` | code 0 |
| `git diff --check` | propre |

Aucun push, aucune API payante, aucun systemd, ComfyUI 8188/8189 non touché, `scripts/deleguer.sh` intact, vrai `~/.codebuddy` non écrit.

## Doctor

```
Native sandbox: Landlock ABI 7 usable; bubblewrap /usr/bin/bwrap present but unusable (bwrap: setting up uid map: Permission denied). opt-in CODEBUDDY_NATIVE_SANDBOX=true (fail-closed if confinement cannot be applied)
```
