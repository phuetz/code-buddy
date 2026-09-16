# VERIF-VITALS-GMI — CPU instantané par delta /proc

**Fichier** : `src/sensory/system-vitals-emitter.ts` (553 LOC, lecture seule)
**Mission** : vérifier l'arithmétique et les cas limites du correctif qui a remplacé
`ps -o pcpu` (moyenne de vie) par un CPU instantané `(Δjiffies / clk_tck) / Δt · 100`.
**Test** : `HOME=$PWD/_qa/gmi/home npx vitest run tests/sensory/system-vitals-emitter.test.ts`
→ **18 passed / 18** (27 ms, 1 fichier, 0 échec).

---

## Vérification arithmétique & cas limites

### (1) `clk_tck` — sysconf ou 100 en dur ? — **OK**

Deux résolveurs, même politique : on **n'appelle pas** `os.cpus()` / `sysconf`. On se
contente d'un override explicite ou de la variable d'env `CODEBUDDY_CLK_TCK`, avec
fallback 100. Justification : Node n'expose pas `_SC_CLK_TCK` ; 100 est la valeur
historique Linux x86_64, surchargeable via env (utile en sandbox où `SC_CLK_TCK` peut
être inhabituel). C'est documenté inline (l. 108, 232-236, 275) et le test couvre
le fallback.

- L. 108 : `/** Clock ticks per second (sysconf _SC_CLK_TCK). Default: CODEBUDDY_CLK_TCK or 100. */`
- L. 232-236 : `resolveClkTck` — `deps.clkTck > 0` sinon env sinon `100`.
- L. 275 : `defaultReadProcesses` réplique exactement la même règle (évite la
  double lecture, mais garantit la cohérence pour `etimeSec = uptime − startTime/clkTck`).

### (2) `Δt` — même horloge que les jiffies ? en secondes ? — **OK**

- `now = (deps.now ?? Date.now)()` (l. 375) → `Date.now()` = **wall-clock UTC ms**
  (epoch 1970), donc strictement décroissant et monotone.
- Les jiffies `utime+stime` et `starttime` viennent de `/proc/<pid>/stat` (l. 251-253,
  259), mesurés par le noyau en **jiffies d'horloge** depuis le boot.
- La conversion est correcte : `dtSec = (now − before.sampledAt) / 1000` (l. 499) et
  `cpuPct = (dJiffies / clkTck / dtSec) * 100` (l. 501).
- Subtilité assumée : `Date.now()` et les jiffies kernel ne partagent pas la même
  base (wall vs monotonic-from-boot), mais ce n'est pas requis : on calcule
  `Δjiffies / Δwallclock`, qui converge vers le vrai taux quand la mesure est
  répétée, et c'est exactement ce qu'on veut (l'arithmétique mélange deux Δ, pas
  deux absolus).
- Garde `dtSec > 0 && dJiffies >= 0` (l. 500) → pas de division par 0, pas de
  division par un Δt négatif (monotonicité de `Date.now` le garantit de toute
  façon, mais c'est défensif).

### (3) Processus multi-thread à 800 % : seuil 90 déclenché, payload « par cœur » ? — **DÉFAUT (mineur)**

- Calcul : un process 8 threads à 100 % chacun donne `pcpu = 800`. `cpuPct >= 90` (l. 516)
  → le seuil **se déclenche** correctement.
- Mais le payload (l. 520-529) ne dit **pas** « par cœur ». Champs : `pid`, `ppid`,
  `comm`, `pcpu`, `etimeSec`, `passes`, `cpuThreshold`, `scope`. Aucun champ
  `perCore`, `nproc`, `cpuCount`, `coreNormalized`, etc.
- Conséquence opérationnelle : un opérateur voit `pcpu: 800` sans savoir si c'est
  8×100 ou 800×1. Le correctif est **suffisant** (le seuil 90 attrape les deux
  cas), mais le payload est ambigu pour le diagnostic humain et pour toute règle
  downstream qui voudrait pondérer par cœur.
- Sévérité : **bas** — pas de faux négatif, juste un manque de métadonnée. À
  corriger en ajoutant `cpuCount: os.cpus()?.length ?? 1` au payload.

### (4) 1re vue sans faux delta, PID-reuse via startTime — **OK**

- 1re vue (l. 503-506) : `sameProcess` est `false` → `cpuPct = null` → la branche
  `if (cpuPct !== null && cpuPct >= cpuThreshold)` est sautée, et `counters.delete`
  purge toute baseline antérieure. **Pas de faux delta.**
- PID-reuse (l. 491-494) : la garde compare **trois** champs, pas seulement
  `startTime` :
  ```ts
  sameProcess =
    !!before && before.startTime === s.startTime
             && s.etimeSec + 2 >= before.etimeSec;
  ```
  - `startTime` : identity guard nominal (le kernel recycle un pid avec un
    `starttime` strictement plus récent → mismatch détecté).
  - `etimeSec + 2 >= before.etimeSec` : garde défensive contre un cas pathologique
    (starttime identique mais le process aurait vieilli en négatif — impossible en
    pratique, mais bloque toute lecture corrompue).
  - Le `+ 2` absorbe ~2 s de drift entre deux lectures `/proc` (normal entre
    passes heartbeat).
- Reset : nouvelle identité → `counters.delete(s.pid)` (l. 505) puis `prev.set(...)`
  (l. 509-514) établit la baseline fraîche. Prochaine passe aura un delta valide.

### (5) `/proc` illisible : passe sautée SANS purger — **OK**

- `try { ... } catch { samples = null; }` (l. 474-479) — toute exception du reader
  est convertie en `null`.
- `if (samples !== null) { ... }` (l. 482) — la **totalité** du bloc runaway
  (calcul de delta, incrément des compteurs, émission, purge des pids morts) est
  gardée par ce `if`. Si `samples === null` :
  - `counters` n'est pas incrémenté (donc une panne `/proc` ne déclenche pas de
    faux runaway, mais ne reset pas non plus un compteur légitime en cours).
  - `prev` n'est pas mis à jour (donc le `startTime` de référence est préservé —
    pas de risque d'attribuer le `startTime` d'un *nouveau* pid à un ancien).
  - Aucun `delete`/`clear` n'est exécuté dans cette branche : la sémantique
    « skip WITHOUT purging » (l. 481 en commentaire, BUG-06) est respectée.
- Cas couverts par le `try/catch` : zombie (`/proc/<pid>/stat` lisible mais
  contenu vide → `parseStat` retourne `null` → filtré en amont), permission
  refusée (`readFileSync` throw → `continue` l. 305, pas un return null), `/proc`
  absent (readdir throw l. 285 → return null).
- Subtilité : une permission refusée sur un pid isolé est gérée par `continue`
  (l. 305), donc le reste de la passe continue — c'est le bon comportement. Seul
  un `/proc` globalement inaccessible (container, non-Linux) déclenche le skip
  total.

### (6) Dormant puis emballement : détecté après N passes, pas avant — **OK**

- Trace pas-à-pas d'un process qui passe de 0 % à 100 % entre la passe k et la
  passe k+1 :
  - Passe k : `cpuPct < 90` → branche `else if (cpuPct !== null)` (l. 532) →
    `counters.delete(s.pid)`. Le compteur est à 0 (ou n'existe pas).
  - Passe k+1 : `cpuPct = 100` ≥ 90 → `next = (counters.get(s.pid) ?? 0) + 1 = 1`.
    `1 >= 3` est faux → **pas d'émission**.
  - Passe k+2 : `next = 2`. `2 >= 3` est faux → **pas d'émission**.
  - Passe k+3 : `next = 3`. `3 >= 3` est vrai → **émission** `process_runaway`.
- Donc **3 passes consécutives** après la montée = détection à la 3e, pas avant.
- Comportement inverse (process qui retombe sous le seuil entre deux pics) :
  le `else if` (l. 532) reset immédiatement le compteur, ce qui évite les faux
  positifs cumulatifs sur des pics sporadiques. C'est le bon choix pour
  l'incident 2026-09-05 (boucles **persistantes**, pas transitoires).

---

## Résumé des défauts

| # | Point | Statut | Sévérité |
|---|---|---|---|
| 1 | `clk_tck` sysconf/env/100 | OK | — |
| 2 | `Δt` ms → s, jiffies / `clkTck` | OK | — |
| 3 | 800 % détecté, **payload non annoté « par cœur »** | DÉFAUT | bas (pas de faux négatif, métadonnée manquante) |
| 4 | 1re vue / PID-reuse (startTime + etime) | OK | — |
| 5 | `/proc` illisible → skip sans purge | OK | — |
| 6 | N=3 passes consécutives requises | OK | — |

**1 défaut mineur identifié** (point 3 — payload `process_runaway` n'expose pas le
nombre de cœurs, ce qui rend `pcpu: 800` ambigu côté consommateur/UI). Le bug
arithmétique original (moyenne de vie via `ps -o pcpu`) est **corrigé** : la
formule est juste, les gardes monotonie/division sont en place, et les 18 tests
Vitest passent.

## Commande & résultat

```bash
HOME=$PWD/_qa/gmi/home npx vitest run tests/sensory/system-vitals-emitter.test.ts
# → Test Files  1 passed (1)
#   Tests       18 passed (18)
#   Duration    477ms
```

VITALS: 1 défaut
