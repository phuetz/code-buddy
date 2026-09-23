# lane_lib.sh — Bibliothèque de garde des chaînes de lanes

## Synopsis

Bibliothèque bash pure (sans dépendances externes) qui élimine les 6 pièges identifiés dans l'audit
[`AUDIT-SCRIPTS-FLOTTE-QWENFLASH-2026-09-09`](./reports/2026-09/AUDIT-SCRIPTS-FLOTTE-QWENFLASH-2026-09-09.md) :

| N° | Piège corrigé | Fonction |
|----|---------------|----------|
| 1  | `grep` muet sur journal binaire | `lane_log` filtre `\xFF` via `tr -cd` |
| 2  | Test de push `docs-only` faux (HEAD bouge) | `lane_push_docs_only` compare `base..HEAD` |
| 3  | Auto-kill par `pkill -f` (tue tout) | Pidfiles avec vérification `/proc/<pid>/cmdline` |
| 4  | Garde OpenCode bloquée par shell résiduel | `lane_oc_guard` verrou pidfile atomique |
| 5  | Marqueur de fin écrit sur échec | `lane_marker_end` marque `ÉCHOUÉ` distinct |
| 6  | Fonction déjà chargée / `set -e` absent | Sourçable, `set -euo pipefail` implicite |

## Utilisation

```bash
#!/usr/bin/env bash
set -euo pipefail
. "${BASH_SOURCE%/*}/scripts/lane_lib.sh"

build() {
    lane_log "Début build"
    lane_charge_ok || { lane_log "Charge trop élevée, abort"; return 1; }
    make -j$(nproc) 2>&1 | tee "$LANE_JOURNAL/build.log"
    lane_wait_marker "$LANE_JOURNAL/build.log" "BUILD_COMPLETE" 300 || return 1
    lane_commit_staged "$(pwd)" "chore(build): update artifacts"
    lane_push_docs_only "$(pwd)" HEAD~1 HEAD '\.(md|json)$'
    lane_marker_end "$LANE_JOURNAL/build.log" "build" $?
}
```

## API complète

### `lane_log "msg"`
Horodatage `[YYYY-MM-DD HH:MM:SS] msg`. Filtre octets non imprimables via `tr -cd`.
Écriture en append (`>>`) sur `$LANE_JOURNAL/lane.log`.

### `lane_wait_marker "journal" "marqueur" [timeout_s]`
`grep -aqF` borné par timeout (défaut 300 s). Retour 0 si trouvé, 1 sinon.

### `lane_pidfile_start nom cmd…` / `lane_pidfile_running nom [cmd]` / `lane_pidfile_kill nom [signal]`
Répertoire `$LANE_RUN_DIR`. Jamais `pkill -f`. Vérifie `/proc/<pid>/cmdline` pour confirmer
que le PID porte bien la commande attendue.

### `lane_oc_guard`
Verrou OpenCode par pidfile `_opencode.pid`. Refuse si un processus vivant existe.

### `lane_push_docs_only dépôt base branche motif_autorisé`
Compare `git diff --name-only base..HEAD`. Push uniquement si TOUS les fichiers matchent.
Journalise la liste si refus.

### `lane_commit_staged dépôt message`
Commit uniquement si l'index contient des fichiers modifiés.

### `lane_marker_end journal nom code`
Écrit `=== <nom> TERMINÉ ===` + `MARKER_<nom>_TERMINÉ`.
Si code ≠ 0 : écrit `=== <nom> ÉCHOUÉ ===` + `MARKER_<nom>_ECHOUÉ` (ASCII fallback).
Permet aux chaînes suivantes de détecter un échec sans relancer la même opération.

### `lane_charge_ok [load_max] [mem_min_go]`
Vérifie charge CPU (< load_max %) et RAM libre (> mem_min_go Mo).
Retour 1 si seuils dépassés.

## Tests

```bash
bash tests/scripts/lane_lib.test.sh
```

**Résultat :** 21 OK, 0 KO

| Section | Couverture |
|---------|-----------|
| lane_log | Horodatage + filtrage binaire (`\xFF\xFE`) |
| lane_wait_marker | Trouvé, fichier absent, timeout |
| Pidfile helpers | Start, running, cmdline match/mismatch, kill propre/inexistant |
| lane_oc_guard | Verrou libre, verrou occupé |
| lane_push_docs_only | Tous docs, fichier hors motif |
| lane_commit_staged | Index vide, index non vide |
| lane_marker_end | Terminé (code=0), Échoué (code≠0) |
| lane_charge_ok | Seuils hauts (passe), 0% (bloque) |

## Variables d'environnement

| Variable | Défaut | Description |
|----------|--------|-------------|
| `$LANE_JOURNAL` | `/tmp` | Répertoire des journaux |
| `$LANE_RUN_DIR` | `/tmp/lanes` | Répertoire des pidfiles |
| `$LANE_LOAD_THRESHOLD` | `80` | Charge CPU max (%) |
| `$LANE_MEM_MIN_GO` | `512` | RAM minimale (Mo) |

---

*Écrit le 2026-09-09 — Mission qwenflash/lane-lib-2026-09-09*
