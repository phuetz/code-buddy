# VERIF-KILL-AGY — Vérification adversariale de l'action `kill_process` (Grok)

**Date** : 2026-09-05  
**Auditeur** : Antigravity (Google DeepMind)  
**Dépôt** : `~/DEV/cb-heartwatch-2026-09-05`  
**Branche** : `grok/runaway-remediation-2026-09-05`  
**Commits audités** :  
- `06c287c9b` : `feat(sensory): action kill_process bornée (anti PID-reuse, double opt-in)`  
- `080117da5` : `feat(sensory): gabarit process-runaway-kill (dryRun, cooldown 60s)`  
- `084b512b1` : `docs(heartwatch): CODEBUDDY_RUNAWAY_KILL et remédiation bornée`  
**Rapport Grok audité** : `docs/reports/2026-09/RUNAWAY-REMEDIATION-GROK.md`  
**Environnement de test** : `HOME=~/DEV/cb-heartwatch-2026-09-05/_qa/agy-kill/home` et `env -u FORCE_COLOR`  

---

## 1. Vérification (1) : Byte-identique sans règle ni variable d'environnement

### 1.1. Sans règle `kill_process` enregistrée
Dans `src/sensory/sensory-rules-engine.ts:412-467`, la boucle de dispatch parcourt les règles enregistrées :
- Si aucune règle n'a `action.type === 'kill_process'`, la fonction `executeSensoryAction` n'est jamais appelée avec ce type d'action.
- `src/sensory/system-vitals-emitter.ts:607` a simplement ajouté `startTime: s.startTime` dans le payload du percept `process_runaway`. Ce champ était déjà lu depuis `/proc/<pid>/stat` (ligne 321) pour la détection de réutilisation de PID ; aucun nouveau code ni sous-processus n'est exécuté lors du flux normal des événements.

### 1.2. Inatteignabilité stricte de `process.kill` sans `CODEBUDDY_RUNAWAY_KILL=true`
Chemin dans `src/sensory/sensory-action-executor.ts` :
- Ligne 252-254 : `isRunawayKillArmed()` retourne `process.env.CODEBUDDY_RUNAWAY_KILL === 'true'`.
- Lignes 326-329 :
  ```ts
  const requestedDry = action.dryRun !== false;
  const armed = isRunawayKillArmed();
  const dryRun = requestedDry || !armed;
  const dryReason = !requestedDry && !armed ? 'CODEBUDDY_RUNAWAY_KILL unset' : 'dryRun';
  ```
- Lignes 420-433 :
  ```ts
  if (dryRun) {
    return finishKill({
      ok: true,
      detail: dryReason,
      payload: { ... }
    });
  }
  ```
- Lignes 436 et 457 : les appels `process.kill(pid, 'SIGTERM')` et `process.kill(pid, 'SIGKILL')` sont situés **exclusivement après** la ligne 420.
- Si `CODEBUDDY_RUNAWAY_KILL` n'est pas `'true'`, `armed` est `false`, donc `dryRun` est obligatoirement `true`. La sortie anticipée à la ligne 420 est garantie : `process.kill` est structurellement inatteignable.

**Preuve expérimentale (test avec spy, `dryRun: false` et variable d'environnement absente) :**
```bash
HOME=$PWD/_qa/agy-kill/home env -u FORCE_COLOR node --import tsx --input-type=module -e "
import { executeSensoryAction } from './src/sensory/sensory-action-executor.js';
delete process.env.CODEBUDDY_RUNAWAY_KILL;
let killCalled = false;
const origKill = process.kill;
process.kill = ((...args) => { killCalled = true; return true; });
const res = await executeSensoryAction(
  { type: 'kill_process', dryRun: false },
  {
    kind: 'process_runaway',
    payload: { pid: 4242, comm: 'node', startTime: 12345 }
  },
  {
    readProc: (pid) => ({ pid, ppid: 1, comm: 'node', startTime: 12345, uid: process.getuid?.() ?? 1000 }),
    selfPid: 9999999,
  }
);
console.log('Result ok:', res.ok, 'detail:', res.detail, 'killCalled:', killCalled);
process.kill = origKill;
if (killCalled) process.exit(1);
"
```
**Sortie :**
```text
[2026-09-05T20:25:56.797Z] ℹ️ INFO  [rules] kill_process CODEBUDDY_RUNAWAY_KILL unset pid=4242 comm=node
Result ok: true detail: CODEBUDDY_RUNAWAY_KILL unset killCalled: false
```
`killCalled` est `false`, 0 appel à `process.kill`.

---

## 2. Vérification (2) : Origine du PID et filtrage d'ingress bridge WebSocket

### 2.1. Rejet d'une règle avec `pid` par `validateRule`
Fichier : `src/sensory/sensory-rules-engine.ts:180-182`
```bash
HOME=$PWD/_qa/agy-kill/home env -u FORCE_COLOR node --import tsx --input-type=module -e "
import { validateRule } from './src/sensory/sensory-rules-engine.js';
const v = validateRule({
  id: 'test-kill',
  match: { modality: 'system', kind: 'process_runaway' },
  action: { type: 'kill_process', pid: 1234 }
});
console.log('validateRule with pid:', v);
if (v.ok) process.exit(1);
"
```
**Sortie :**
```text
validateRule with pid: {
  ok: false,
  errors: [
    'kill_process must not set pid (pid comes from the process_runaway percept)'
  ]
}
```

### 2.2. L'exécuteur ignore tout PID hors percept
Fichier : `src/sensory/sensory-action-executor.ts:339` (`perceptPid(ctx.payload)`)
```bash
HOME=$PWD/_qa/agy-kill/home env -u FORCE_COLOR node --import tsx --input-type=module -e "
import { executeSensoryAction } from './src/sensory/sensory-action-executor.js';
process.env.CODEBUDDY_RUNAWAY_KILL = 'true';
let targetKilled = null;
const origKill = process.kill;
process.kill = ((pid, signal) => { targetKilled = { pid, signal }; return true; });
const res = await executeSensoryAction(
  { type: 'kill_process', dryRun: false, pid: 999 },
  {
    kind: 'process_runaway',
    payload: { pid: 4242, comm: 'node', startTime: 12345 }
  },
  {
    readProc: (pid) => ({ pid, ppid: 1, comm: 'node', startTime: 12345, uid: process.getuid?.() ?? 1000 }),
    selfPid: 88888,
  }
);
console.log('Target killed:', targetKilled, 'result:', res);
process.kill = origKill;
if (!targetKilled || targetKilled.pid !== 4242) process.exit(1);
"
```
**Sortie :**
```text
[2026-09-05T20:26:04.084Z] ℹ️ INFO  [rules] kill_process SIGTERM pid=4242 comm=node
Target killed: { pid: 4242, signal: 'SIGTERM' } result: { ok: true, detail: 'SIGTERM' }
```
L'action porte `pid: 999`, mais seul le PID `4242` du percept a été ciblé.

### 2.3. Percept forgé via le bridge WebSocket externe
Fichier : `src/sensory/sensory-bridge.ts:51,141-143` :
- `KNOWN_MODALITIES = new Set(['audio', 'vision', 'screen', 'vital', 'ui'])`
- Ligne 141 : `if (!KNOWN_MODALITIES.has(frame.modality)) return;`

**Test adversarial sur le bridge WebSocket :**
```bash
HOME=$PWD/_qa/agy-kill/home env -u FORCE_COLOR node --import tsx --input-type=module -e "
import { startSensoryBridge } from './src/sensory/sensory-bridge.js';
import { getGlobalEventBus } from './src/events/event-bus.js';
import WebSocket from 'ws';

const bus = getGlobalEventBus();
let busEvents = [];
const subId = bus.on('sensory:perception', (evt) => {
  busEvents.push(evt);
});

const bridge = startSensoryBridge({ host: '127.0.0.1', port: 18942 });
await bridge.ready;

const ws = new WebSocket('ws://127.0.0.1:18942');
await new Promise((resolve) => ws.on('open', resolve));

// 1. Percept forgé 'system'
ws.send(JSON.stringify({
  modality: 'system',
  kind: 'process_runaway',
  salience: 200,
  payload: { pid: 1234, comm: 'bash', startTime: 100 }
}));

// 2. Percept valide 'vision'
ws.send(JSON.stringify({
  modality: 'vision',
  kind: 'person_entered',
  salience: 100,
  payload: { camera: 'front' }
}));

// 3. Percept forgé 'vital' avec kind 'process_runaway'
ws.send(JSON.stringify({
  modality: 'vital',
  kind: 'process_runaway',
  salience: 200,
  payload: { pid: 5678, comm: 'bash', startTime: 200 }
}));

await new Promise((resolve) => setTimeout(resolve, 300));
ws.close();
await bridge.close();
bus.off(subId);

console.log('Received bus events count:', busEvents.length);
for (const e of busEvents) {
  console.log('Event:', e.metadata?.modality, e.metadata?.kind);
}
"
```
**Sortie :**
```text
[2026-09-05T20:26:07.522Z] ℹ️ INFO  [sensory] bridge listening on ws://127.0.0.1:18942
[2026-09-05T20:26:07.539Z] ℹ️ INFO  [sensory] daemon connected
Received bus events count: 2
Event: vision person_entered
Event: vital process_runaway
```

**Analyse de la vulnérabilité (TROU A) :**
1. Un frame avec `modality: 'system'` est bien bloqué à l'ingress du bridge (`sensory-bridge.ts:141`) car `'system'` est absent de `KNOWN_MODALITIES`.
2. **MAIS** le bridge autorise `modality: 'vital'` (`KNOWN_MODALITIES.has('vital') === true`) et la fonction `sanitizeKind` (`sensory-bridge.ts:66`) accepte `process_runaway`. Par conséquent, **un client WebSocket externe PEUT injecter un percept `process_runaway` avec un PID arbitraire** sur le bus sous `modality: 'vital'`.
3. Le gabarit par défaut `tpl-process-runaway-kill` (`src/sensory/rule-templates.ts:51`) possède `match: { modality: 'system', kind: 'process_runaway' }`, ce qui le protège contre ce frame (`ruleMatches` compare la modalité si spécifiée).
4. **Cependant**, `validateRule` (`src/sensory/sensory-rules-engine.ts:177-179`) n'exige **PAS** `rule.match.modality === 'system'` (il accepte une règle avec seulement `match: { kind: 'process_runaway' }` ou `match: { modality: 'vital', kind: 'process_runaway' }`). De plus, `runKillProcess` (`src/sensory/sensory-action-executor.ts:331`) ne vérifie pas `ctx.modality === 'system'`.
5. Si un utilisateur définit une règle de remédiation sans spécifier `modality: 'system'`, un client WebSocket local peut injecter un percept `process_runaway` et déclencher l'action `kill_process` !

---

## 3. Vérification (3) : Anti PID-reuse et parsing de `/proc/<pid>/stat`

Fichier : `src/sensory/sensory-action-executor.ts:206-238`

### 3.1. Parsing avec espaces et parenthèses dans `comm`
L'implémentation utilise :
```ts
const open = content.indexOf('(');
const close = content.lastIndexOf(')');
const comm = content.slice(open + 1, close);
const after = content.slice(close + 1).trim().split(/\s+/);
const startTime = Number(after[19]);
```
Dans le noyau Linux, `/proc/<pid>/stat` entoure `comm` de parenthèses. Si `comm` contient lui-même des parenthèses ou des espaces (ex: `(my prog))` ou `(my (fancy) prog))`), `open` prend la première parenthèse ouvrante et `close` prend la dernière fermante. Tous les champs après la dernière `)` sont des scalaires (champ 3 `state`, champ 4 `ppid`, ..., champ 22 `starttime`).
Le champ 22 correspond exactement à `after[19]` (champ 3 + 19 = champ 22).

**Preuve expérimentale :**
```bash
HOME=$PWD/_qa/agy-kill/home env -u FORCE_COLOR node --import tsx --input-type=module -e "
import { parseProcStat } from './src/sensory/sensory-action-executor.js';

function makeStat(comm, ppid, starttime) {
  const dummies = new Array(17).fill('0').join(' ');
  return \`1234 (\${comm}) S \${ppid} \${dummies} \${starttime} 9999 8888\`;
}

const t1 = parseProcStat(makeStat('bash', 100, 54321));
const t2 = parseProcStat(makeStat('my prog', 100, 54321));
const t3 = parseProcStat(makeStat('my prog)', 100, 54321));
const t4 = parseProcStat(makeStat('(my (fancy) prog))', 100, 54321));

const raw = makeStat('test', 42, 77777);
const after = raw.slice(raw.lastIndexOf(')') + 1).trim().split(/\s+/);

console.log('Test 1 (normal):', t1);
console.log('Test 2 (espace):', t2);
console.log('Test 3 (parenthèse fermante):', t3);
console.log('Test 4 (parenthèses imbriquées):', t4);
console.log('after[0] (champ 3 state):', after[0]);
console.log('after[1] (champ 4 ppid):', after[1]);
console.log('after[19] (champ 22 starttime):', after[19]);

if (t3.startTime !== 54321 || t4.startTime !== 54321 || Number(after[19]) !== 77777) {
  process.exit(1);
}
"
```
**Sortie :**
```text
Test 1 (normal): { comm: 'bash', ppid: 100, startTime: 54321 }
Test 2 (espace): { comm: 'my prog', ppid: 100, startTime: 54321 }
Test 3 (parenthèse fermante): { comm: 'my prog)', ppid: 100, startTime: 54321 }
Test 4 (parenthèses imbriquées): { comm: '(my (fancy) prog))', ppid: 100, startTime: 54321 }
after[0] (champ 3 state): S
after[1] (champ 4 ppid): 42
after[19] (champ 22 starttime): 77777
```

### 3.2. Refus si `/proc` est illisible (fail-closed)
- Dans `readProcIdentity` (`src/sensory/sensory-action-executor.ts:220-237`), les lectures de `/proc/${pid}/stat` et `/proc/${pid}/status` sont dans des blocs `try/catch`. En cas d'échec (processus disparu, permissions), la fonction retourne `null`.
- Dans `runKillProcess` (`lignes 357-365`), si `live === null`, retour immédiat avec `{ ok: false, detail: 'pid absent' }` et aucun signal n'est envoyé.

**Preuve expérimentale :**
```bash
HOME=$PWD/_qa/agy-kill/home env -u FORCE_COLOR node --import tsx --input-type=module -e "
import { readProcIdentity, executeSensoryAction } from './src/sensory/sensory-action-executor.js';

console.log('readProcIdentity(99999999):', readProcIdentity(99999999));
console.log('readProcIdentity(-5):', readProcIdentity(-5));
console.log('readProcIdentity(0):', readProcIdentity(0));

const actRes = await executeSensoryAction(
  { type: 'kill_process', dryRun: false },
  { kind: 'process_runaway', payload: { pid: 99999999, comm: 'ghost', startTime: 123 } },
  { readProc: () => null }
);
console.log('executeSensoryAction with null proc:', actRes);
if (actRes.ok !== false || actRes.detail !== 'pid absent') process.exit(1);
"
```
**Sortie :**
```text
readProcIdentity(99999999): null
readProcIdentity(-5): null
readProcIdentity(0): null
[2026-09-05T20:26:37.696Z] ⚠️ WARN  [rules] kill_process pid absent pid=99999999
executeSensoryAction with null proc: { ok: false, detail: 'pid absent' }
```

---

## 4. Vérification (4) : Protections (self, ancêtres, pid 1, autre uid, pid ≤ 0, graceMs, escalate)

Fichier : `src/sensory/sensory-action-executor.ts`

### 4.1. Refus de `process.pid`, ancêtres, pid 1, autre UID, pid ≤ 0
- Refus de `self` : ligne 396 (`pid === selfPid`)
- Refus des ancêtres : ligne 403 (`isAncestorOfSelf(pid, selfPid, readProc)`). Lignes 273-290 : parcours de la chaîne des `ppid` via `readProc` jusqu'à `ppid <= 0` ou `current <= 1`, avec protection `Set<number>` contre les boucles de reparentage. Si un ancêtre intermédiaire disparaît, Linux reparente automatiquement le processus fils à PID 1 (ou `readProc` retourne `null`), ce qui arrête la boucle proprement.
- Refus de PID 1 : ligne 389 (`pid === 1`)
- Refus d'un autre UID : ligne 411 (`uid === null || live.uid === null || live.uid !== uid`). `readProcIdentity` extrait l'UID réel via `/proc/<pid>/status` (`^Uid:\s+(\d+)`).
- Refus de PID ≤ 0 : ligne 349 (`pid === null || pid <= 0`). Interdit `kill(0)` (groupe du processus appelant) et `kill(-pid)` (groupe de processus).

**Preuve expérimentale :**
```bash
HOME=$PWD/_qa/agy-kill/home env -u FORCE_COLOR node --import tsx --input-type=module -e "
import { executeSensoryAction } from './src/sensory/sensory-action-executor.js';

process.env.CODEBUDDY_RUNAWAY_KILL = 'true';
let killCalls = [];
process.kill = ((pid, sig) => { killCalls.push({ pid, sig }); return true; });

const selfPid = 5000;
const currentUid = 1000;

const procTable = {
  5000: { pid: 5000, ppid: 4000, comm: 'node', startTime: 10, uid: currentUid },
  4000: { pid: 4000, ppid: 3000, comm: 'bash', startTime: 8, uid: currentUid },
  3000: { pid: 3000, ppid: 1, comm: 'sshd', startTime: 5, uid: currentUid },
  1: { pid: 1, ppid: 0, comm: 'systemd', startTime: 1, uid: 0 },
  6000: { pid: 6000, ppid: 1, comm: 'otheruser', startTime: 20, uid: 1001 },
  7000: { pid: 7000, ppid: 1, comm: 'victim', startTime: 30, uid: currentUid },
};

const deps = {
  readProc: (pid) => procTable[pid] ?? null,
  getuid: () => currentUid,
  selfPid,
};

// 1. Refus de self
const rSelf = await executeSensoryAction(
  { type: 'kill_process', dryRun: false },
  { kind: 'process_runaway', payload: { pid: 5000, comm: 'node', startTime: 10 } },
  deps
);
console.log('1. Self:', rSelf.detail);

// 2. Refus du parent (4000)
const rParent = await executeSensoryAction(
  { type: 'kill_process', dryRun: false },
  { kind: 'process_runaway', payload: { pid: 4000, comm: 'bash', startTime: 8 } },
  deps
);
console.log('2. Parent:', rParent.detail);

// 3. Refus du grand-parent (3000)
const rGrandParent = await executeSensoryAction(
  { type: 'kill_process', dryRun: false },
  { kind: 'process_runaway', payload: { pid: 3000, comm: 'sshd', startTime: 5 } },
  deps
);
console.log('3. Grandparent:', rGrandParent.detail);

// 4. Refus de PID 1
const rPid1 = await executeSensoryAction(
  { type: 'kill_process', dryRun: false },
  { kind: 'process_runaway', payload: { pid: 1, comm: 'systemd', startTime: 1 } },
  deps
);
console.log('4. PID 1:', rPid1.detail);

// 5. Refus autre UID
const rOtherUid = await executeSensoryAction(
  { type: 'kill_process', dryRun: false },
  { kind: 'process_runaway', payload: { pid: 6000, comm: 'otheruser', startTime: 20 } },
  deps
);
console.log('5. Other UID:', rOtherUid.detail);

// 6. Refus PID <= 0
const rPid0 = await executeSensoryAction(
  { type: 'kill_process', dryRun: false },
  { kind: 'process_runaway', payload: { pid: 0, comm: 'idle', startTime: 0 } },
  deps
);
console.log('6. PID 0:', rPid0.detail);
const rPidNeg = await executeSensoryAction(
  { type: 'kill_process', dryRun: false },
  { kind: 'process_runaway', payload: { pid: -100, comm: 'grp', startTime: 10 } },
  deps
);
console.log('6b. PID negative:', rPidNeg.detail);
"
```
**Sortie :**
```text
[2026-09-05T20:26:44.509Z] ⚠️ WARN  [rules] kill_process self pid=5000
1. Self: self
[2026-09-05T20:26:44.511Z] ⚠️ WARN  [rules] kill_process ancestor pid=4000
2. Parent: ancestor
[2026-09-05T20:26:44.511Z] ⚠️ WARN  [rules] kill_process ancestor pid=3000
3. Grandparent: ancestor
[2026-09-05T20:26:44.511Z] ⚠️ WARN  [rules] kill_process pid 1 pid=1
4. PID 1: pid 1
[2026-09-05T20:26:44.511Z] ⚠️ WARN  [rules] kill_process other uid pid=6000
5. Other UID: other uid
[2026-09-05T20:26:44.512Z] ⚠️ WARN  [rules] kill_process invalid pid
6. PID 0: invalid pid
[2026-09-05T20:26:44.512Z] ⚠️ WARN  [rules] kill_process invalid pid pid=-100
6b. PID negative: invalid pid
```

### 4.2. Bornage de `graceMs` et conditions d'escalade `SIGKILL`
- Lignes 247-250 : `clampGraceMs(raw)` borne strictement entre 1 000 et 60 000 ms.
- Lignes 446-472 : Si `escalate === true`, après `sleep(clampGraceMs(action.graceMs))`, `/proc` est relu. `SIGKILL` n'est envoyé que si `still` existe, `still.comm === commExpected`, `still.startTime === startExpected`, `still.pid !== 1` et `still.pid !== selfPid`. Si le processus est mort ou son PID réutilisé, aucun `SIGKILL` n'est émis.

**Preuve expérimentale :**
```bash
HOME=$PWD/_qa/agy-kill/home env -u FORCE_COLOR node --import tsx --input-type=module -e "
import { executeSensoryAction } from './src/sensory/sensory-action-executor.js';

process.env.CODEBUDDY_RUNAWAY_KILL = 'true';
let sleptMs = [];
const sleep = async (ms) => { sleptMs.push(ms); };
let killCalls = [];
process.kill = ((pid, sig) => { killCalls.push({ pid, sig }); return true; });

const currentUid = 1000;
let processAlive = true;
let processStartTime = 100;

const deps = {
  readProc: (pid) => {
    if (!processAlive) return null;
    return { pid, ppid: 1, comm: 'victim', startTime: processStartTime, uid: currentUid };
  },
  getuid: () => currentUid,
  selfPid: 9999,
  sleep,
};

const runawayCtx = {
  kind: 'process_runaway',
  payload: { pid: 7777, comm: 'victim', startTime: 100 }
};

// 1. graceMs = 0 -> borné à 1000
sleptMs = []; killCalls = []; processAlive = true;
await executeSensoryAction({ type: 'kill_process', dryRun: false, escalate: true, graceMs: 0 }, runawayCtx, deps);
console.log('graceMs=0 slept:', sleptMs[0]);

// 2. graceMs = 1e9 -> borné à 60000
sleptMs = []; killCalls = []; processAlive = true;
await executeSensoryAction({ type: 'kill_process', dryRun: false, escalate: true, graceMs: 1e9 }, runawayCtx, deps);
console.log('graceMs=1e9 slept:', sleptMs[0]);

// 3. escalate = false -> pas de SIGKILL
sleptMs = []; killCalls = []; processAlive = true;
const resNoEsc = await executeSensoryAction({ type: 'kill_process', dryRun: false, escalate: false }, runawayCtx, deps);
console.log('escalate=false calls:', killCalls, 'result:', resNoEsc.detail);

// 4. Processus mort après SIGTERM -> pas de SIGKILL
sleptMs = []; killCalls = []; processAlive = true;
const depsDied = { ...deps, sleep: async (ms) => { sleptMs.push(ms); processAlive = false; } };
const resDied = await executeSensoryAction({ type: 'kill_process', dryRun: false, escalate: true, graceMs: 2000 }, runawayCtx, depsDied);
console.log('process died calls:', killCalls, 'result:', resDied.detail);

// 5. PID réutilisé (nouveau startTime) -> pas de SIGKILL
sleptMs = []; killCalls = []; processAlive = true;
const depsReused = { ...deps, sleep: async (ms) => { sleptMs.push(ms); processStartTime = 999; } };
const resReused = await executeSensoryAction({ type: 'kill_process', dryRun: false, escalate: true, graceMs: 2000 }, runawayCtx, depsReused);
console.log('process reused calls:', killCalls, 'result:', resReused.detail);

// 6. Processus survivant identique -> SIGKILL envoyé
sleptMs = []; killCalls = []; processAlive = true; processStartTime = 100;
const resSurvived = await executeSensoryAction({ type: 'kill_process', dryRun: false, escalate: true, graceMs: 2000 }, runawayCtx, deps);
console.log('process survived calls:', killCalls, 'result:', resSurvived.detail);
"
```
**Sortie :**
```text
[2026-09-05T20:26:50.828Z] ℹ️ INFO  [rules] kill_process SIGKILL pid=7777 comm=victim
graceMs=0 slept: 1000
[2026-09-05T20:26:50.830Z] ℹ️ INFO  [rules] kill_process SIGKILL pid=7777 comm=victim
graceMs=1e9 slept: 60000
[2026-09-05T20:26:50.830Z] ℹ️ INFO  [rules] kill_process SIGTERM pid=7777 comm=victim
escalate=false calls: [ { pid: 7777, sig: 'SIGTERM' } ] result: SIGTERM
[2026-09-05T20:26:50.830Z] ℹ️ INFO  [rules] kill_process SIGTERM pid=7777 comm=victim
process died calls: [ { pid: 7777, sig: 'SIGTERM' } ] result: SIGTERM
[2026-09-05T20:26:50.831Z] ℹ️ INFO  [rules] kill_process SIGTERM pid=7777 comm=victim
process reused calls: [ { pid: 7777, sig: 'SIGTERM' } ] result: SIGTERM
[2026-09-05T20:26:50.831Z] ℹ️ INFO  [rules] kill_process SIGKILL pid=7777 comm=victim
process survived calls: [ { pid: 7777, sig: 'SIGTERM' }, { pid: 7777, sig: 'SIGKILL' } ] result: SIGKILL
```

---

## 5. Vérification (5) : Moteur de règles (cooldown, plafonds, percept émis, absence de boucle)

Fichiers : `src/sensory/sensory-rules-engine.ts:413-433` et `src/sensory/sensory-action-executor.ts:292-316`

### 5.1. Cooldown et plafonds
- Cooldown : ligne 415 (`t - lastFired < cd`)
- In-flight deduplication : ligne 417 (`running.has(rule.id)`)
- Cap max in-flight : ligne 421 (`inFlight >= maxInFlight`)
- Rate-limit par seconde : ligne 426 (`recent.length >= maxFiresPerSec`)

**Preuve expérimentale (cooldown de 60 s) :**
```bash
HOME=$PWD/_qa/agy-kill/home env -u FORCE_COLOR node --import tsx --input-type=module -e "
import { wireSensoryRules } from './src/sensory/sensory-rules-engine.js';
import { getGlobalEventBus } from './src/events/event-bus.js';

let fires = 0;
let currentTime = 1000;
const bus = getGlobalEventBus();

const unwire = wireSensoryRules({
  rules: [{
    id: 'rule-cooldown',
    match: { modality: 'system', kind: 'process_runaway' },
    action: { type: 'kill_process' },
    cooldownMs: 60_000,
  }],
  now: () => currentTime,
  execute: async () => { fires++; return { ok: true }; }
});

function emitRunaway() {
  bus.emit('sensory:perception', {
    source: 'system-vitals',
    metadata: { modality: 'system', kind: 'process_runaway', payload: { pid: 1234, comm: 'bash', startTime: 100 } }
  });
}

emitRunaway();
await new Promise((r) => setTimeout(r, 50));
console.log('Fires after 1st event:', fires);

currentTime = 1500;
emitRunaway();
await new Promise((r) => setTimeout(r, 50));
console.log('Fires after 2nd event (t=1500):', fires);

currentTime = 62000;
emitRunaway();
await new Promise((r) => setTimeout(r, 50));
console.log('Fires after 3rd event (t=62000):', fires);

unwire();
if (fires !== 2) process.exit(1);
"
```
**Sortie :**
```text
[2026-09-05T20:26:55.843Z] ℹ️ INFO  [rules] rule-cooldown (kill_process) → ok
Fires after 1st event: 1
Fires after 2nd event (t=1500): 1
[2026-09-05T20:26:55.944Z] ℹ️ INFO  [rules] rule-cooldown (kill_process) → ok
Fires after 3rd event (t=62000): 2
```

### 5.2. Percept `process_remediated` émis avec `dryRun` vrai/faux
**Preuve expérimentale :**
```bash
HOME=$PWD/_qa/agy-kill/home env -u FORCE_COLOR node --import tsx --input-type=module -e "
import { executeSensoryAction } from './src/sensory/sensory-action-executor.js';
import { getGlobalEventBus } from './src/events/event-bus.js';

const bus = getGlobalEventBus();
let remediated = [];
const id = bus.on('sensory:perception', (e) => {
  if (e.metadata?.kind === 'process_remediated') remediated.push(e.metadata.payload);
});

const currentUid = 1000;
const deps = {
  readProc: (pid) => ({ pid, ppid: 1, comm: 'bash', startTime: 100, uid: currentUid }),
  getuid: () => currentUid,
  selfPid: 9999,
};

const runawayCtx = { kind: 'process_runaway', payload: { pid: 4242, comm: 'bash', startTime: 100 } };

delete process.env.CODEBUDDY_RUNAWAY_KILL;
await executeSensoryAction({ type: 'kill_process' }, runawayCtx, deps);
console.log('1. Remediated dry-run default:', remediated[0]);

process.env.CODEBUDDY_RUNAWAY_KILL = 'true';
process.kill = (() => true);
await executeSensoryAction({ type: 'kill_process', dryRun: false }, runawayCtx, deps);
console.log('2. Remediated armed live:', remediated[1]);

bus.off(id);
"
```
**Sortie :**
```text
[2026-09-05T20:27:00.568Z] ℹ️ INFO  [rules] kill_process dryRun pid=4242 comm=bash
1. Remediated dry-run default: {
  pid: 4242,
  comm: 'bash',
  signal: 'SIGTERM',
  dryRun: true,
  ok: true,
  reason: 'dryRun'
}
[2026-09-05T20:27:00.569Z] ℹ️ INFO  [rules] kill_process SIGTERM pid=4242 comm=bash
2. Remediated armed live: {
  pid: 4242,
  comm: 'bash',
  signal: 'SIGTERM',
  dryRun: false,
  ok: true,
  reason: 'SIGTERM'
}
```

### 5.3. Absence totale de boucle infinie
L'action émet uniquement `kind: 'process_remediated'` (avec `modality: 'system'`).
Les règles `kill_process` exigent `match.kind === 'process_runaway'` (validé par `validateRule`).
Aucune règle `kill_process` ne peut réagir à `process_remediated`. Aucune boucle de rétroaction n'est possible.

---

## 6. Vérification (6) : Rejoue des suites de tests et vérifications de types

### 6.1. Suite `tests/security/donnees-personnelles.test.ts`
```bash
HOME=~/DEV/cb-heartwatch-2026-09-05/_qa/agy-kill/home env -u FORCE_COLOR npx vitest run tests/security/donnees-personnelles.test.ts
```
**Sortie :**
```text
 RUN  v4.1.9 ~/DEV/cb-heartwatch-2026-09-05

 Test Files  1 passed (1)
      Tests  40 passed (40)
   Start at  22:27:05
   Duration  5.67s (transform 46ms, setup 26ms, import 48ms, tests 5.41s, environment 0ms)
```

### 6.2. Type-checking TypeScript
```bash
npx tsc --noEmit -p tsconfig.json | tail -2
```
**Sortie :**
```text
(code retour 0, aucune erreur)
```

### 6.3. Suite complète demandée `tests/sensory tests/cli`
```bash
HOME=~/DEV/cb-heartwatch-2026-09-05/_qa/agy-kill/home env -u FORCE_COLOR npx vitest run tests/sensory tests/cli
```
**Sortie :**
```text
 RUN  v4.1.9 ~/DEV/cb-heartwatch-2026-09-05

 Test Files  100 passed | 1 skipped (101)
      Tests  891 passed | 4 skipped | 1 todo (896)
   Start at  22:27:54
   Duration  98.41s (transform 4.33s, setup 1.06s, import 14.16s, tests 231.29s, environment 12ms)
```

---

## Synthèse adversariale point par point

| Point | Statut | Gravité | Fichier:Ligne | Preuve / Explication |
|---|---|---|---|---|
| **1. Byte-identique sans règle ni env** | **TIENT** | — | `src/sensory/sensory-action-executor.ts:327,420` | `dryRun = requestedDry \|\| !armed; if (dryRun) return;` avant les lignes 436/457. `process.kill` inatteignable sans `CODEBUDDY_RUNAWAY_KILL=true`. Prouvé par test spy (0 appel). |
| **2a. PID uniquement du percept** | **TIENT** | — | `src/sensory/sensory-rules-engine.ts:180` et `sensory-action-executor.ts:339` | `validateRule` rejette `pid` dans l'action. L'exécuteur lit `ctx.payload?.pid` et ignore `action.pid`. Prouvé par tests. |
| **2b. Ingress WS bridge : filtrage `modality:'system'`** | **TIENT** | — | `src/sensory/sensory-bridge.ts:51,141` | `'system'` n'est pas dans `KNOWN_MODALITIES`. Les frames WS avec `modality:'system'` sont jetés à l'ingress. |
| **2c. Ingress WS bridge : injection `process_runaway` via `vital`** | **TROU** | **A** | `src/sensory/sensory-bridge.ts:51,141-143`, `src/sensory/sensory-rules-engine.ts:177`, `src/sensory/sensory-action-executor.ts:331` | Le bridge autorise `modality: 'vital'` et tout `kind` alphanumérique dont `process_runaway`. `validateRule` n'exige pas `match.modality === 'system'` et `runKillProcess` ne vérifie pas `ctx.modality === 'system'`. Un client WS peut donc injecter un percept `process_runaway` arbitraire sous `modality: 'vital'`, qui déclenchera toute règle `kill_process` n'ayant pas verrouillé explicitement sa modalité sur `system`. |
| **3. Anti PID-reuse (`/proc/<pid>/stat`)** | **TIENT** | — | `src/sensory/sensory-action-executor.ts:206-238` | `comm` extrait entre le premier `(` et le dernier `)`. Gère espaces et parenthèses. Champ 22 `starttime` = `after[19]`. Fail-closed si `/proc` illisible. Prouvé par tests. |
| **4. Protections (self, ancêtres, pid 1, autre uid, pid ≤ 0, graceMs, escalate)** | **TIENT** | — | `src/sensory/sensory-action-executor.ts:247-290,349,389,396,403,411,446` | Refus de self (`selfPid`), des ancêtres (`isAncestorOfSelf`), de pid 1, d'un autre UID (`/proc/<pid>/status`), de pid ≤ 0. `graceMs` borné 1000–60000. `SIGKILL` uniquement si `escalate:true`, processus survivant et vérifications réitérées. |
| **5. Rules engine (cooldown, plafonds, `process_remediated`, pas de boucle)** | **TIENT** | — | `src/sensory/sensory-rules-engine.ts:413-433`, `src/sensory/sensory-action-executor.ts:292` | Cooldown et caps in-flight/par-seconde opérationnels. `process_remediated` émis avec `dryRun` exact. Aucune boucle (`kill_process` n'écoute pas `process_remediated`). |
| **6. Suites de tests et types** | **TIENT** | — | `tests/sensory`, `tests/cli`, `tests/security/donnees-personnelles.test.ts` | 100 fichiers / 891 tests sensory+cli passés. 40/40 données personnelles passés. `tsc --noEmit` exit code 0. |

---

### Recommandations de remédiation pour le TROU A :
1. Dans `src/sensory/sensory-rules-engine.ts:177` (`validateRule`) :
   ```ts
   if (rule.match?.kind !== 'process_runaway' || rule.match?.modality !== 'system') {
     errors.push('kill_process requires match.kind process_runaway and match.modality system');
   }
   ```
2. Dans `src/sensory/sensory-action-executor.ts:331` (`runKillProcess`) :
   ```ts
   if (ctx.kind !== 'process_runaway' || ctx.modality !== 'system') {
     return finishKill({
       ok: false,
       detail: 'kind/modality mismatch',
       payload: { dryRun: true, ok: false, reason: 'kind/modality mismatch' },
     });
   }
   ```
3. Dans `src/sensory/sensory-bridge.ts` :
   Restreindre les `kind` autorisés pour la modalité `vital` au seul `heartbeat`, empêchant l'ingress d'autres kinds système.

---

VERDICT: 1 trou
