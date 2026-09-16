# VERIF-SURV2-AGY — Vérification indépendante de la surveillance v2 de Grok

**Date** : 2026-09-05  
**Auditeur** : agy (Gemini 3.8 Flash)  
**Dépôt** : `~/DEV/cb-heartwatch-2026-09-05`  
**Branche auditée** : `grok/surveillance-ameliorations-2026-09-05`  
**Commits vérifiés** :
- `f31004d6f` : `feat(sensory): payload process_runaway multi-cœur + CODEBUDDY_RUNAWAY_CPU_BASIS`
- `62ef2559d` : `feat(sensory): pacemaker TS de repli (CODEBUDDY_HEARTBEAT_FALLBACK)`
- `1de88f026` : `feat(cli): buddy sensory status (lecture seule, --json)`
- `f18eaf307` : `docs(heartwatch): env multi-cœur, fallback TS, sensory status`  
**Rapport de référence de Grok** : `docs/reports/2026-09/SURVEILLANCE-V2-GROK.md`  
**Environnement de test isolé** : `HOME=$PWD/_qa/agy-v2/home` et `env -u FORCE_COLOR`

---

## 1. Vérification détaillée point par point

### Point (1) : Byte-identique sans flag

#### 1.1 `CODEBUDDY_HEARTBEAT_FALLBACK`
Sans la variable d'environnement `CODEBUDDY_HEARTBEAT_FALLBACK=true` :
- Dans `src/server/index.ts` (lignes 2088–2093), l'import dynamique et l'initialisation du pacemaker TS de secours sont conditionnés par une garde stricte :
  ```ts
  2088: if (process.env.CODEBUDDY_HEARTBEAT_FALLBACK === 'true') {
  2089:   const { startHeartbeatFallback } = await import('../sensory/heartbeat-fallback.js');
  2090:   const fallback = startHeartbeatFallback();
  2091:   sensoryTeardown.push(() => fallback.stop());
  2092:   logger.info('Heartbeat fallback: Enabled (CODEBUDDY_HEARTBEAT_FALLBACK) - TS pacemaker until buddy-sense beats');
  2093: }
  ```
- De plus, dans `src/sensory/heartbeat-fallback.ts` (lignes 86–95), si `startHeartbeatFallback()` est appelé avec `enabled = false` (ou sans variable d'env), la fonction retourne immédiatement un handle inerte sans créer de timer (`setInterval`/`setTimeout`) et sans enregistrer d'écouteur sur l'event bus (`bus.on`) :
  ```ts
  86: export function startHeartbeatFallback(deps: HeartbeatFallbackDeps = {}): HeartbeatFallbackHandle {
  87:   const enabled = deps.enabled ?? isHeartbeatFallbackEnabled();
  88:   if (!enabled) {
  89:     return {
  90:       stop() {},
  91:       getSource: () => 'none',
  92:       lastBeatAt: () => null,
  93:       lastRealBeatAt: () => null,
  94:     };
  95:   }
  ```

**Preuve par le test** (`tests/sensory/heartbeat-fallback.test.ts`, lignes 65–73) :
```bash
env -u FORCE_COLOR HOME=$PWD/_qa/agy-v2/home npx vitest run tests/sensory/heartbeat-fallback.test.ts -t "is disabled by default"
```
```text
Test Files  1 passed (1)
     Tests  1 passed | 4 skipped (5)
```

#### 1.2 `CODEBUDDY_RUNAWAY_CPU_BASIS`
Sans la variable d'environnement `CODEBUDDY_RUNAWAY_CPU_BASIS=machine` :
- Dans `src/sensory/system-vitals-emitter.ts` (lignes 268–271), la résolution de la base s'effectue par défaut sur `'core'` :
  ```ts
  268: function resolveCpuBasis(deps: SystemVitalsDeps): RunawayCpuBasis {
  269:   if (deps.cpuBasis === 'machine' || deps.cpuBasis === 'core') return deps.cpuBasis;
  270:   return process.env.CODEBUDDY_RUNAWAY_CPU_BASIS === 'machine' ? 'machine' : 'core';
  271: }
  ```
- Aux lignes 561–564 de `src/sensory/system-vitals-emitter.ts`, la variable `compared` utilisée pour le déclenchement du seuil `compared >= cpuThreshold` conserve exactement la valeur `pcpuTotal = round1(cpuPct)` :
  ```ts
  561: const pcpuTotal = round1(cpuPct);
  562: const pcpuOfMachine = round1(pcpuTotal / cores);
  563: const compared = cpuBasis === 'machine' ? pcpuOfMachine : pcpuTotal;
  564: if (compared >= cpuThreshold) {
  ```
  Le seuil est donc comparé au pourcentage d'un seul cœur (identique au comportement avant commit `f31004d6f`).

**Preuve par le test** (`tests/sensory/system-vitals-emitter.test.ts`, lignes 356–378) :
```bash
env -u FORCE_COLOR HOME=$PWD/_qa/agy-v2/home npx vitest run tests/sensory/system-vitals-emitter.test.ts -t "unset BASIS is byte-identical"
```
```text
Test Files  1 passed (1)
     Tests  1 passed | 21 skipped (22)
```

---

### Point (2) : Jamais deux horloges

Inspection de `src/sensory/heartbeat-fallback.ts` :

1. **Course critique / collision de battements** :
   Node.js exécute le code JavaScript de manière mono-threadée et coopérative sur la boucle d'événements. À la ligne 178 de `heartbeat-fallback.ts`, l'écouteur `sensory:perception` intercepte tout battement réel :
   ```ts
   178: const listenerId = bus.on('sensory:perception', (evt: BaseEvent) => {
   179:   if (stopped || !isVitalHeartbeat(evt)) return;
   180:   if (evt.source === FALLBACK_HEARTBEAT_SOURCE) {
   181:     lastBeatMs = now();
   182:     return;
   183:   }
   184:   lastRealMs = now();
   185:   lastBeatMs = lastRealMs;
   186:   source = 'rust';
   187:   stopEmitClock();
   188:   armSilence();
   189: });
   ```
   Dès qu'un battement réel arrive, `stopEmitClock()` est appelé immédiatement de façon synchrone :
   ```ts
   143: const stopEmitClock = (): void => {
   144:   fallbackActive = false;
   145:   if (emitTimer !== undefined) {
   146:     clearIntervalFn(emitTimer);
   147:     emitTimer = undefined;
   148:   }
   149: };
   ```
   Si un battement de repli est émis à $t_0$, et qu'un battement réel de `buddy-sense` arrive à $t_0 + 200\text{ ms}$, les deux événements peuvent coexister dans la même seconde civile au moment exact de la transition (« handoff »), mais l'horloge de repli est immédiatement désarmée. Les deux horloges ne continuent donc jamais en parallèle.

2. **Réarmement après silence et gigue à 1 Hz** :
   La constante `DEFAULT_SILENCE_MS` est fixée à 15 000 ms (15 secondes, ligne 51). Chaque battement réel réinitialise ce délai via `clearSilence()` puis `setTimeout(..., silenceMs)` (lignes 168–176). Pour un daemon battant à 1 Hz (1 battement par seconde), une gigue normale de quelques centaines de millisecondes (ou même plusieurs secondes de latence sous forte charge) ne permet jamais d'atteindre le seuil des 15 secondes. Il n'y a donc aucun risque d'oscillation sous un flux régulier à 1 Hz.

3. **`unref()` et arrêt au teardown** :
   Les timers créés sont systématiquement détachés de l'event loop via `unrefTimer()` :
   - Ligne 165 : `unrefTimer(emitTimer);`
   - Ligne 175 : `unrefTimer(silenceTimer);`
   Au teardown, `fallback.stop()` (lignes 199–206) annule les deux timers et désenregistre l'écouteur du bus (`bus.off(listenerId)`). Ce nettoyage est dûment enregistré dans `sensoryTeardown` à la ligne 2091 de `src/server/index.ts`. Aucun handle ne fuite (les tests vitest s'exécutent en moins de 500 ms et se terminent proprement).

**Preuve par le test** (`tests/sensory/heartbeat-fallback.test.ts`) :
```bash
env -u FORCE_COLOR HOME=$PWD/_qa/agy-v2/home npx vitest run tests/sensory/heartbeat-fallback.test.ts
```
```text
Test Files  1 passed (1)
     Tests  5 passed (5)
  Duration  467ms
```

---

### Point (3) : Multi-cœur

Inspection de `src/sensory/system-vitals-emitter.ts` :

1. **Origine de `cores`** :
   Déterminé dans `resolveNproc(deps)` (lignes 256–266) :
   ```ts
   256: function resolveNproc(deps: SystemVitalsDeps): number {
   257:   if (typeof deps.nproc === 'number' && Number.isFinite(deps.nproc) && deps.nproc >= 1) {
   258:     return Math.floor(deps.nproc);
   259:   }
   260:   try {
   261:     const n = cpus()?.length ?? 0;
   262:     return n >= 1 ? n : 1;
   263:   } catch {
   264:     return 1;
   265:   }
   266: }
   ```
   - La valeur est issue de `os.cpus().length` (`import { cpus } from 'node:os'`).
   - `os.availableParallelism()` n'est pas utilisé.
   - **Quotas cgroups ignorés** : Les fichiers `/sys/fs/cgroup/cpu.max` et `cpu.cfs_quota_us` ne sont pas inspectés. Dans un conteneur contraint en CPU (par exemple un conteneur avec quota de 2 cœurs sur une machine hôte de 64 cœurs), `cores` vaut 64. Ainsi, si `CODEBUDDY_RUNAWAY_CPU_BASIS=machine` est activé en conteneur, un processus saturant 100 % de son allocation (200 % de charge mono-cœur) rapportera `pcpuOfMachine = 200 / 64 = 3.125 %`, restant très loin du seuil de 90 % et masquant complètement l'emballement.

2. **Bornage de `pcpuOfMachine`** :
   À la ligne 562 :
   ```ts
   562: const pcpuOfMachine = round1(pcpuTotal / cores);
   ```
   La valeur n'est **pas bornée** entre 0 et 100 % (aucun `Math.min(100, Math.max(0, ...))`). Si la mesure du delta temporel `dtSec` présente un aléa de chronométrage par rapport aux jiffies consommés sur un intervalle court, `pcpuOfMachine` peut dépasser 100 %.

3. **Division par zéro** :
   **Impossible**. `resolveNproc()` garantit que le dénominateur est un entier $\ge 1$ (`n >= 1 ? n : 1` et repli sur `1` dans le bloc `catch`).

---

### Point (4) : `buddy sensory status`

#### 4.1 Exécution réelle SANS serveur
Exécution via `npx tsx src/index.ts sensory status` et `--json` avec `HOME` hermétique :

```bash
HOME=$PWD/_qa/agy-v2/home npx tsx src/index.ts sensory status
```
```text
Serveur : serveur non joignable
Flags   : SENSORY=off  SYSTEM_VITALS=off  SCHEDULE_TICKS=off  DOMAIN_EVENTS=off  RULES=off  HEARTBEAT_FALLBACK=off
Battement : aucun
Traitements : (aucun enregistré)
Dernières perceptions system/time : (aucune)
Règles : (aucune chargée)
```
*(Code retour : 0)*

```bash
HOME=$PWD/_qa/agy-v2/home npx tsx src/index.ts sensory status --json
```
```json
{
  "serverReachable": false,
  "serverMessage": "serveur non joignable",
  "flags": {
    "SENSORY": false,
    "SYSTEM_VITALS": false,
    "SCHEDULE_TICKS": false,
    "DOMAIN_EVENTS": false,
    "RULES": false,
    "HEARTBEAT_FALLBACK": false
  },
  "heartbeat": {
    "source": "aucun",
    "lastBeatAt": null,
    "lastBeatAgoSec": null
  },
  "treatments": [],
  "recent": [],
  "rules": []
}
```
*(Code retour : 0)*

#### 4.2 Confidentialité & Données sensibles
- **Secret `CODEBUDDY_SENSORY_TOKEN`** : Testé avec `CODEBUDDY_SENSORY_TOKEN="super-secret-token-12345"`. Le jeton n'apparaît ni dans la sortie texte ni dans le JSON (il n'est ni lu ni propagé par `src/sensory/sensory-status.ts` ou `src/commands/cli/sensory-command.ts`).
- **Chemins absolus personnels** : Aucun chemin personnel n'est exposé.

#### 4.3 Streaming vs Mémoire pour `rule-runs.jsonl`
Dans `src/sensory/sensory-status.ts` (ligne 260) :
```ts
260: const runs = await (deps.listRuns ?? readRuleRuns)(200);
```
Dans `src/sensory/sensory-rules-engine.ts` (lignes 256–262) :
```ts
256: export async function readRuleRuns(limit = 20): Promise<RuleRun[]> {
257:   const runs = await readJsonLinesAtomic<RuleRun>(auditPath(), [], (value): value is RuleRun => Boolean(
258:     value && typeof value === 'object' && typeof (value as RuleRun).ts === 'number' &&
259:     typeof (value as RuleRun).rule === 'string',
260:   ));
261:   return runs.slice(-limit).reverse();
262: }
```
Dans `src/utils/atomic-write.ts` (lignes 493–506) :
```ts
495: contents = await fsPromises.readFile(filePath, 'utf8');
...
506: const parsed = parseJsonLines(contents, isValid);
```
`readJsonLinesAtomic` lit l'**intégralité du fichier en mémoire** avec `fsPromises.readFile('...utf8')` d'un seul bloc, puis découpe et parse toutes les lignes en mémoire avant de n'en retenir que les 200 dernières. Sur un fichier `rule-runs.jsonl` de 100 Mo, la totalité des 100 Mo est chargée en mémoire vive. **Il n'y a aucun streaming.**

---

### Point (5) : `tests/security/donnees-personnelles.test.ts`

Exécution de la suite de sécurité :

```bash
env -u FORCE_COLOR HOME=$PWD/_qa/agy-v2/home npx vitest run tests/security/donnees-personnelles.test.ts
```
```text
 ❯ tests/security/donnees-personnelles.test.ts (40 tests | 1 failed) 3380ms
     × aucun fichier suivi ne nomme la situation ou l’infrastructure privée de l’auteur 3369ms

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/security/donnees-personnelles.test.ts > aucune donnée personnelle dans un dépôt public > aucun fichier suivi ne nomme la situation ou l’infrastructure privée de l’auteur
AssertionError: Ce dépôt est public. Ces termes désignent la situation ou l’infrastructure privée de son auteur et ne doivent pas y figurer — pas même comme sujet d’essai dans un test.
Pour un test : utiliser « organisme témoin » et poser INFLUENCER_EXCLUDED_TOPICS dans le test lui-même.
Pour un document de travail : le dépôt privé de passation, hors de ce dépôt public.

docs/reports/2026-09/VERIFICATION-FIX-AGY.md → /home/<nom-auteur>: expected [ Array(1) ] to deeply equal []

- Expected
+ Received

- []
+ [
+   "docs/reports/2026-09/VERIFICATION-FIX-AGY.md → /home/<nom-auteur>",
+ ]

 ❯ tests/security/donnees-personnelles.test.ts:465:7
```

**Analyse de responsabilité** :
- Les 15 fichiers créés ou modifiés par Grok dans sa branche (`f31004d6f`, `62ef2559d`, `1de88f026`, `f18eaf307`) sont **100 % propres** et ne contiennent aucune occurrence de données personnelles.
- L'échec est provoqué par le fichier `docs/reports/2026-09/VERIFICATION-FIX-AGY.md` (ligne 45), introduit lors du commit parent `6f877e343`.
- Cependant, comme `tests/security/donnees-personnelles.test.ts` vérifie l'ensemble des fichiers suivis par git (`fichiersSuivis()`), ce test échoue sur le dépôt, ce qui bloque la CI de sécurité.

---

### Point (6) : Suites de validation globales

1. **Vitest sur `tests/sensory` et `tests/cli`** :
```bash
env -u FORCE_COLOR HOME=$PWD/_qa/agy-v2/home npx vitest run tests/sensory tests/cli
```
```text
 Test Files  98 passed | 1 skipped (99)
      Tests  867 passed | 4 skipped | 1 todo (872)
   Duration  108.39s
```
*(Code retour : 0 — 100 % conforme aux 98 fichiers et 867 tests attendus).*

2. **Contrôle de types TypeScript** :
```bash
npx tsc --noEmit -p tsconfig.json | tail -2
```
*(Sortie vide, code retour : 0).*

---

## 2. Tableau synthétique point → statut

| Point | Objet | Statut | Fichier : Ligne | Preuve |
|---|---|---|---|---|
| **(1)** | **Byte-identique sans flag** | **TIENT** | `src/server/index.ts:2088-2093`<br>`src/sensory/heartbeat-fallback.ts:86-95`<br>`src/sensory/system-vitals-emitter.ts:268-271, 561-564` | `tests/sensory/heartbeat-fallback.test.ts:65-73` (aucun beat émis sans env) ; `tests/sensory/system-vitals-emitter.test.ts:356-378` (seuil 90 sur 100 % d'un cœur préservé sur 8 cœurs). |
| **(2)** | **Jamais deux horloges** | **TIENT** | `src/sensory/heartbeat-fallback.ts:165, 175, 178-190, 199-206`<br>`src/server/index.ts:2091` | Mono-thread JS synchrone ; `stopEmitClock()` coupe le repli dès le 1er beat réel ; silence 15 s immunisé à la gigue 1 Hz ; `unrefTimer()` et teardown serveur sans fuite de handle. |
| **(3)** | **Multi-cœur** | **TROU** | `src/sensory/system-vitals-emitter.ts:261, 562` | `cores` calculé via `os.cpus().length` en ignorant les quotas cgroups (aveugle en conteneur) ; `pcpuOfMachine` non borné à [0, 100] (peut dépasser 100 % sous gigue d'échantillonnage). Division par zéro bien évitée (`n >= 1`). |
| **(4)** | **`buddy sensory status`** | **TROU** | `src/sensory/sensory-rules-engine.ts:257`<br>`src/utils/atomic-write.ts:495` | La commande CLI fonctionne sans serveur (exit 0) et sans fuite de secret/chemin, mais `readRuleRuns()` charge l'intégralité de `rule-runs.jsonl` en mémoire vive via `readFile` (aucun streaming sur un fichier de 100 Mo). |
| **(5)** | **Données personnelles** | **TROU** | `docs/reports/2026-09/VERIFICATION-FIX-AGY.md:45`<br>`tests/security/donnees-personnelles.test.ts:465` | `tests/security/donnees-personnelles.test.ts` échoue (1 test failed) en raison de la présence d'un chemin personnel dans un rapport commité au commit `6f877e343` (bien que les fichiers de Grok soient propres). |
| **(6)** | **Suites globales (Vitest + TSC)** | **TIENT** | `tests/sensory/`, `tests/cli/`, `tsconfig.json` | Vitest : 98 passés / 867 passés / exit 0 ; TSC : 0 erreur / exit 0. |

---

VERDICT: 3 trous
