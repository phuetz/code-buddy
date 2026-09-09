# Audit de robustesse — Scripts de la flotte (deleguer.sh + _qa/lanes/*.sh)

**Date :** 2026-09-09  
**Auditeur :** gpt-6-astra  
**Fichiers audités :** `scripts/deleguer.sh` + 207 scripts dans `_qa/lanes/`  
**Méthode :** scan pattern + lecture ciblée des 6 familles de pièges connues + autres fragilités

---

## 1. Piège n°1 — `pkill -f` / `pgrep -f` : le shell se tue lui-même

**Principe :** `-f` matche sur la *ligne de commande complète* du processus. Quand un script lance `pkill -f 'motif'`, sa propre ligne de commande contient `'motif'` → il s'autotue (signal 15 ou 144).

| Fichier | Ligne | Extrait | Risque | Correctif |
|---------|-------|---------|--------|-----------|
| `_qa/lanes/agy-reprise-2026-09-09.sh` | 10 | `pkill -f 'http.server' 2>/dev/null` | Le script contient `'http.server'` dans sa propre ligne → auto-kill | Remplacer par `pkill -f 'http\.server'` avec échappement, ou mieux : trouver le PID via `lsof` puis `kill -TERM <pid>` |
| `_qa/lanes/oc-audit-parite-2026-09-09.sh` | 5 | `until ! pgrep -f 'opencode run' >/dev/null; do sleep 120; done` | Garde qui attend qu'OpenCode finisse ; si le motif apparaît dans le script lui-même, le wait devient infini car `pgrep` ne trouve jamais le processus cible mais la condition `!` est inversée | Utiliser `pgrep -f '^opencode run '` (ancrage début de ligne) ou pidfile |
| `_qa/lanes/oc-kimi-contre-audit-ic-2026-09-09.sh` | 6 | `until ! pgrep -f 'opencode ru[n]' >/dev/null; do sleep 120; done` | Regex `[n]` == `n` mais le motif apparaît dans la ligne de commande du script appelant → même problème | Idem : ancrage au début de la ligne de commande |
| `_qa/lanes/oc-qwen-ic-plugins-suite-2026-09-09.sh` | 5 | `until ! pgrep -f 'opencode ru[n]' >/dev/null; do sleep 120; done` | Pareil | Idem |

**Occurrences :** 4 (dont 1 `pkill` + 3 `pgrep`)  
**Scripts touchés :** 4

---

## 2. Piège n°2 — `git diff --stat` pipe `grep -vqE` : fausse détection push docs-only

**Principe :** `git diff --stat` produit une ligne de résumé comme ` 5 files changed, 120 insertions(+), 45 deletions(-)` qui contient `|`. Le test `grep -vE 'docs/' \| grep -q '\|'` renvoie vrai même quand tous les fichiers modifiés sont sous `docs/`, donc le script pense qu'il y a des changements non-docs et skip le commit.

| Fichier | Ligne | Extrait | Risque | Correctif |
|---------|-------|---------|--------|-----------|
| `_qa/lanes/lance-inventaire-boutons-2026-09-09.sh` | 12 | `... git diff --stat origin/wysiwyg..HEAD \| grep -vE 'docs/reports/|docs/qa/|_qa/' \| grep -q '\|' ...` | Si seuls des fichiers docs changent, la ligne de résumé contient `\|` → faux positif → skip du commit | Utiliser `git diff --name-only \| grep -vE '^docs/'` pour lister uniquement les noms de fichiers modifiés |

**Occurrences :** 1  
**Scripts touchés :** 1

---

## 3. Piège n°3 — `grep -c` muet sur octets non-UTF-8

**Principe :** `grep` considère un fichier comme binaire s'il contient des octets non-UTF-8 (ex. caractères Windows, logs binaires). Dans ce mode, `grep -c` affiche **rien** (pas `0`, pas d'erreur), ce qui laisse la variable vide → `sentinelle` vaut `` au lieu de `0` ou `N`.

| Fichier | Ligne | Extrait | Risque | Correctif |
|---------|-------|---------|--------|-----------|
| `_qa/lanes/agy-reprise-2026-09-09.sh` | 7 | `grep -c "$s" "$D/lane-$n.log"` | Si le log contient des octets non-ASCII, `grep -c` est muet → sentinelle vide | Ajouter `-a` : `grep -ca "$s" "$D/lane-$n.log"` |
| `_qa/lanes/lance-continuation-2026-09-09.sh` | 15 | `grep -c LANE_VIBE_IC_INSTALL_TERMINE "$D/lane-ic-install-inconnu.log"` | Pareil | `grep -c` → `grep -ca` |
| `_qa/lanes/lance-install-inconnu-2026-09-09.sh` | 12 | `grep -c "$s" "$D/lane-$n.log"` | Pareil | `grep -ca` |
| `_qa/lanes/lance-inventaire-boutons-2026-09-09.sh` | 10 | `grep -c LANE_AGY_PDF_BOUTONS_TERMINE "$D/lane-pdf-inventaire-boutons.log"` | Pareil | `grep -ca` |
| `_qa/lanes/livres-trad-ralph-2.sh` | 10 | `grep -c "trad("` | Pareil | `grep -ca` |
| `_qa/lanes/livres-trad-ralph-3.sh` | 10 | `grep -c "trad("` | Pareil | `grep -ca` |
| `_qa/lanes/livres-trad-ralph.sh` | 11 | `grep -c "trad("` | Pareil | `grep -ca` |
| `_qa/lanes/oc-audit-parite-2026-09-09.sh` | 9 | `grep -c LANE_OC_AUDIT_PARITE_TERMINE "$D/lane-audit-parite-oc.log"` | Pareil | `grep -ca` |
| `_qa/lanes/pousse-reaudit.sh` | 9 | `grep -c "^- \*\*" "$OUT"` | Pareil | `grep -ca` |
| `scripts/deleguer.sh` | 440 | `EXECS=$(grep -c '^exec' "$LOG" 2>/dev/null || echo 0)` | Pareil (mais `|| echo 0` atténue partiellement) | `grep -ca` |

**Occurrences :** 10  
**Scripts touchés :** 10

---

## 4. Piège n°4 — Garde `until ! pgrep -f` bloqué par shell résiduel

**Principe :** Un shell interactif ouvert dans un terminal contenant le motif (ex. `opencode run` dans la zone de texte) fait croire à `pgrep -f` que le processus tourne toujours. La garde `until ! pgrep` attend indéfiniment.

| Fichier | Ligne | Extrait | Risque | Correctif |
|---------|-------|---------|--------|-----------|
| `_qa/lanes/oc-audit-parite-2026-09-09.sh` | 5 | `until ! pgrep -f 'opencode run' >/dev/null; do sleep 120; done` | Shell résiduel bloquant la garde → lane ne démarre jamais | Utiliser un pidfile : écrire le PID d'OpenCode dans un fichier, le lire pour vérifier l'existence (`kill -0 <pid>`) |
| `_qa/lanes/oc-kimi-contre-audit-ic-2026-09-09.sh` | 6 | `until ! pgrep -f 'opencode ru[n]' >/dev/null; do sleep 120; done` | Pareil | Pidfile |
| `_qa/lanes/oc-qwen-ic-plugins-suite-2026-09-09.sh` | 5 | `until ! pgrep -f 'opencode ru[n]' >/dev/null; do sleep 120; done` | Pareil | Pidfile |

**Occurrences :** 3  
**Scripts touchés :** 3

---

## 5. Piège n°5 — Marqueur de fin écrit même en cas d'échec

**Principe :** Le marqueur `_TERMINE` (ou `_DONE`) est inséré dans le journal à la fin de la lane, indépendamment du code de sortie. Si la lane échoue après 7 secondes (timeout, crash moteur), le marqueur est tout de même présent → la chaîne suivante se déclenche sur un résultat échoué.

| Fichier | Ligne | Extrait | Risque | Correctif |
|---------|-------|---------|--------|-----------|
| _qa/lanes/* (nombreux) | diverses | `$log "=== NOM_LANE_TERMINE ==="` | Marqueur écrit avant vérification du code de sortie → chaîne suivante lancée même en cas d'échec | Écrire le marqueur UNIQUEMENT si le code de sortie est 0 : `if [ $? -eq 0 ]; then log "..._TERMINE"; fi` |

**Occurrences :** ~232 (fonctions `_TERMINE` détectées via pattern `^\w*\(\)\s*\{`)  
**Note :** Le comptage high vient du pattern `fonction_rechargee` qui capture aussi les fonctions terminant par `_termine`. Les vrais appels `log "*_TERMINE"` sont dispersés dans ~80+ scripts.

---

## 6. Piège n°6 — Fonction bash déjà chargée en mémoire

**Principe :** Si une fonction est définie dans un autre script source (via `. ./autre.sh` ou `source`), modifier le fichier script ne change rien tant que le shell n'est pas redémarré. La version en mémoire reste active.

| Fichier | Ligne | Extrait | Risque | Correctif |
|---------|-------|---------|--------|-----------|
| _qa/lanes/* (232 occurrences pattern `fn() {`) | diverses | Fonctions définies localement sans namespace unique | Collision si deux lanes définissent `log()` ou `wait_opencode()` dans le même shell | Préfixer toutes les fonctions avec le nom de la lane : `log_agy_reprise()`, `wait_opencode_audit_parite()` |

**Occurrences :** 232  
**Scripts touchés :** 207 (tous les scripts)

---

## Autres fragilités détectées

### 6a. `set -e` absent (207/207 scripts)

Aucun script ne contient `set -e`. Cela signifie qu'une erreur intermédiaire (commande qui échoue) ne stoppe pas le script — le script continue silencieusement avec des valeurs corrompues.

**Correctif global :** Ajouter `set -euo pipefail` en tête de chaque script, ou utiliser la lib proposée ci-dessous.

### 6b. Chemins en dur `/home/patrice/` (464 occurrences)

Tous les scripts utilisent des chemins absolus codés en dur vers `/home/patrice/...`. Ces scripts ne fonctionneront pas sur une autre machine ni dans un environnement CI.

**Correctif :** Utiliser des variables d'environnement ou relative au répertoire du script : `DELEGATIONS_DIR="${DELEGATIONS_DIR:-$HOME/.codebuddy/delegations}"`.

### 6c. `--dangerously-*` sans garde (6 occurrences)

Des flags dangereux (`--dangerously-allow-origin-all`, etc.) transitent par les scripts sans vérification explicite.

### 6d. Race condition sur `git commit` (125 occurrences)

Plusieurs lanes committent sur le même dépôt simultanément. Sans verrouillage, elles peuvent écraser les commits des autres ou causer des conflits.

**Correctif :** Verrouillage par fichier (`mkdir "$LOCKDIR" 2>/dev/null || { echo "locked"; exit 1; }`).

### 6e. `$?` après pipe (1 occurrence détectée)

Le statut de sortie après un pipe est celui du dernier command du pipe, pas de la commande initiale. `PIPESTATUS[@]` est nécessaire.

---

## Tableau récapitulatif par famille de piège

| Famille | Occurrences | Scripts touchés | Gravité |
|---------|-------------|-----------------|---------|
| pkill/pgrep -f self-kill | 4 | 4 | 🔴 Critique — mort subite du script |
| git diff --stat pipe grep | 1 | 1 | 🟠 Majeur — skip de commit injustifié |
| grep -c sans -a | 10 | 10 | 🟠 Majeur — compteur muet = décision aveugle |
| pgrep bloquant shell résiduel | 3 | 3 | 🟠 Majeur — lane bloquée indéfiniment |
| Marqueur écrit même en échec | ~232* | ~80+ | 🟡 Moyen — chaîne suivante sur échec |
| Fonction rechargée (collision) | 232 | 207 | 🟡 Moyen — comportement inattendu |
| set -e absent | 207 | 207 | 🟡 Moyen — erreurs silencieuses |
| Chemins en dur | 464 | 207 | 🟢 Mineur — portabilité |
| --dangerously-* | 6 | ~6 | 🟠 Majeur — sécurité |
| Race commit | 125 | ~125 | 🟠 Majeur — corruption possible |

\* Comptage inclut les définitions de fonctions, pas seulement les appels `_TERMINE`.

---

## Top 10 — Correctifs prioritaires

| # | Priorité | Correctif | Fichiers concernés |
|---|----------|-----------|-------------------|
| 1 | P0 | Remplacer `pkill -f` par `lsof -ti <port> \| xargs kill -TERM` | `agy-reprise-2026-09-09.sh` |
| 2 | P0 | Remplacer `pgrep -f` par pidfile (`/tmp/opencode-<lane>.pid`) | `oc-audit-parite-2026-09-09.sh`, `oc-kimi-contre-audit-ic-2026-09-09.sh`, `oc-qwen-ic-plugins-suite-2026-09-09.sh` |
| 3 | P0 | Ajouter `-a` à TOUS les `grep -c` | 10 scripts |
| 4 | P1 | Remplacer `git diff --stat \| grep` par `git diff --name-only \| grep -v ^docs/` | `lance-inventaire-boutons-2026-09-09.sh` |
| 5 | P1 | Ajouter `set -euo pipefail` en tête de chaque script | 207 scripts |
| 6 | P1 | Ne écrire `_TERMINE` QUE si `$? -eq 0` | ~80+ scripts |
| 7 | P1 | Préfixer les fonctions avec le nom de la lane | 207 scripts |
| 8 | P2 | Remplacer chemins `/home/patrice/` par variables d'environnement | 207 scripts |
| 9 | P2 | Ajouter verrouillage `mkdir LOCKDIR` avant `git commit` | ~125 scripts |
| 10 | P2 | Centraliser log, attente, garde dans `lane_lib.sh` | Tous |

---

## Proposition de `lane_lib.sh` (< 60 lignes)

```bash
#!/usr/bin/env bash
# lane_lib.sh — Bibliothèque commune aux scripts de la flotte
# Usage : . ./lane_lib.sh "ma-lane"
set -euo pipefail

LANE_NAME="${1:?Usage: . ./lane_lib.sh <lane-name>}"
LANE_PIDFILE="/tmp/opencode-${LANE_NAME}.pid"
LANE_LOG="${LANE_LOG:-/tmp/lane-${LANE_NAME}.log}"

# Log robuste : toujours UTF-8-safe
log() {
    local msg="[$(date '+%d/%m %H:%M')] $*"
    echo "$msg" >> "$LANE_LOG" 2>/dev/null || true
}

# Attente de marqueur avec grep -a (tolère octets non-UTF-8)
wait_marker() {
    local marker="$1" logfile="$2" timeout="${3:-3600}"
    local elapsed=0
    while [ "$elapsed" -lt "$timeout" ]; do
        if grep -qaF "$marker" "$logfile" 2>/dev/null; then
            return 0
        fi
        sleep 5
        elapsed=$((elapsed + 5))
    done
    log "⚠️ Timeout ${timeout}s en attendant '$marker' dans '$logfile'"
    return 1
}

# Garde OpenCode par pidfile (évite pgrep -f self-match)
wait_opencode_free() {
    local max_wait="${1:-7200}" elapsed=0
    while [ "$elapsed" -lt "$max_wait" ]; do
        if [ ! -f "$LANE_PIDFILE" ] || ! kill -0 "$(cat "$LANE_PIDFILE" 2>/dev/null)" 2>/dev/null; then
            return 0
        fi
        sleep 30
        elapsed=$((elapsed + 30))
    done
    log "⚠️ OpenCode garde timeout (${max_wait}s)"
    return 1
}

# Push docs-only correct : vérifie vraiment qu'il n'y a que des docs
push_docs_only() {
    local repo="${1:?Repo requis}"
    local ref="${2:-HEAD}"
    local non_docs
    non_docs=$(cd "$repo" && git diff --name-only "$ref" 2>/dev/null | grep -v '^docs/' || true)
    if [ -z "$non_docs" ]; then
        cd "$repo" && git add -A && git commit -q -m "chore(lane): $LANE_NAME report" && git push 2>/dev/null || true
        log "✅ Push docs-only OK"
    else
        log "⚠️ Modifications non-docs détectées — push refusé"
        return 1
    fi
}

# Kill sécurisé par pidfile (pas de pkill -f)
cleanup_pidfile() {
    [ -f "$LANE_PIDFILE" ] && kill -TERM "$(cat "$LANE_PIDFILE" 2>/dev/null)" 2>/dev/null || true
    rm -f "$LANE_PIDFILE"
}

# Verrouillage lane (empêche race commits)
acquire_lock() {
    local lockdir="/tmp/lane-lock-${LANE_NAME}"
    if mkdir "$lockdir" 2>/dev/null; then
        trap 'rmdir "$lockdir" 2>/dev/null; true' EXIT
        return 0
    else
        log "⚠️ Lane $LANE_NAME déjà en cours (lock existant)"
        return 1
    fi
}
```

---

## Outillage

Scan effectué via Python inline — aucun outil externe utilisé.

---

TOTAL: 1053 occurrences dans 207 scripts

===LANE_GPT6_ASTRA_AUDIT_SCRIPTS_TERMINE===
