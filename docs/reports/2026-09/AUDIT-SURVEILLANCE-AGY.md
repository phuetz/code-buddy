# AUDIT ADVERSARIAL — Surveillance événementielle par battements de cœur

**Date** : 5 septembre 2026  
**Auditeur** : Lignée indépendante (Antigravity / Gemini)  
**Dépôt** : `~/DEV/cb-heartwatch-2026-09-05`  
**Branche** : `feat/surveillance-evenementielle-2026-09-05`  
**Commit audité** : `2a53f459e`  
**Cible de production** : Robot vivant (Lisa)  

---

## 1. Mandat et Synthèse Exécutive

Une revue adversariale indépendante a été menée sur l'ensemble de la fonctionnalité « surveillance événementielle » (Phases 1 à 5). L'objectif est d'interdire tout déploiement sur le robot vivant (Lisa) tant que la propreté, la fidélité des alertes et l'absence d'effets pervers ne sont pas prouvées.

### Verdict Tranché
⛔ **BLOQUANTS À CORRIGER D'ABORD — NE PAS POUSSER EN L'ÉTAT SUR LISA**

Quatre défauts de gravité majeure (A) rendent la fonctionnalité inopérante ou trompeuse en production réelle :
1. **Incompréhension de la métrique `pcpu` sous Linux** : `ps -o pcpu` mesure la moyenne depuis le lancement du processus (`cputime/realtime`) et non le CPU instantané. Un processus qui s'emballe après 2h de vie mettra **18 heures consécutives à 100 % CPU** avant d'atteindre le seuil d'alerte de 90 % !
2. **Faux succès silencieux sur l'action `alert`** : Si aucun token Telegram n'est configuré ou si l'envoi échoue, `executeSensoryAction` renvoie `{ ok: true }` et consigne un succès dans `rule-runs.jsonl`. Personne n'est prévenu et l'audit ment.
3. **Coercion JavaScript `Number(null) === 0` dans le moteur de règles** : Tout champ indisponible (`vramPct: null`, `fleetUtilization: null`) est converti en `0`, déclenchant à tort des alertes de sous-utilisation sur des machines sans GPU.
4. **Dérive d'échantillonnage de `schedule-emitter`** : Échantillonner toutes les 60 secondes avec une règle en égalité stricte `filters: { hhmm: '04:20' }` fait sauter des minutes entières au moindre jitter d'une seconde de l'event loop.

---

## 2. Tableau Récapitulatif des Bugs Détectés

| ID | Fichier:Ligne | Nature du Bug | Gravité | Scénario d'Échec Reproductible |
|---|---|---|---|---|
| **BUG-01** | `src/sensory/system-vitals-emitter.ts:48,221,411` | `pcpu` dans `ps` est une moyenne sur la durée de vie du processus (`cputime / etimes`), pas le CPU instantané | **A (Bloquant)** | Processus au repos pendant 2h, puis boucle à 100 % : `pcpu` ne dépasse 90 % qu'après 18h de chauffe ininterrompue. Alerte jamais déclenchée. |
| **BUG-02** | `src/sensory/sensory-action-executor.ts:168-170` | Faux succès silencieux : `executeSensoryAction` ignore la valeur de retour de `sendTelegramAlert` et renvoie `{ ok: true }` | **A (Bloquant)** | Pas de token Telegram configuré : alerte jamais reçue sur le téléphone, mais audit log (`rule-runs.jsonl`) consignant `ok: true`. |
| **BUG-03** | `src/sensory/sensory-rules-engine.ts:65-66` | Coercion JavaScript `Number(null) === 0` sur les métriques manquantes | **A (Bloquant)** | Machine sans GPU (`vramPct: null`) : une règle `{ op: 'lte', value: 10 }` ou `{ op: 'eq', value: 0 }` s'active à chaque battement. |
| **BUG-04** | `src/sensory/schedule-emitter.ts:39-48` + `rule-templates.ts:95` | Ticks sautés par dérive d'échantillonnage sur filtre d'égalité stricte `hhmm` | **A (Bloquant)** | Battements à 60s avec jitter de 1s : passe à 04:19:59 puis 04:21:00. La minute 04:20 n'est jamais émise, sonde non exécutée. |
| **BUG-05** | `src/sensory/system-vitals-emitter.ts:85,97,411-414` | Recyclage de PID (PID reuse) sans validation temporelle (`etimeSec`) ni `comm` | **B** | Le PID 4500 meurt à 2 passes > 90 %. Un nouveau processus prend le PID 4500 : il est faussement alerté comme runaway dès sa 1ère seconde. |
| **BUG-06** | `src/sensory/system-vitals-emitter.ts:264-266,433-435` | Un échec transitoire ou timeout de `ps` (5s) purge instantanément tous les compteurs consécutifs | **B** | Sous forte charge, un appel `ps` dépasse 5s. `readChildren` catch et renvoie `[]`. Tous les compteurs sont effacés, retardant l'alerte. |
| **BUG-07** | `src/sensory/system-vitals-emitter.ts:177,244-263` | Scope `server` (défaut) aveugle aux processus orphelins (reparenting PID 1 / subreaper) | **B** | Un agent lance un sous-processus qui boucle et le parent meurt : le processus est reparenté à PID 1. Hors de l'arbre du serveur, il est ignoré. |
| **BUG-08** | `src/sensory/system-vitals-emitter.ts:180-184` | Impossibilité de vider `CODEBUDDY_RUNAWAY_IGNORE_COMM` (retombe sur la liste par défaut) | **C** | `CODEBUDDY_RUNAWAY_IGNORE_COMM=""` recharge `DEFAULT_IGNORE_COMM` (`list.length === 0`). Impossible de surveiller `node`/`python`. |
| **BUG-09** | `src/sensory/system-vitals-emitter.ts:186-191` | Filtrage de préfixe trop laxiste dans `isIgnoredComm` (`c.startsWith(entry)`) | **C** | Tout binaire débutant par un préfixe ignoré (ex. `nodemapper`, `python_loop`, `cargo-miner`) est totalement immunisé à la garde. |
| **BUG-10** | `src/sensory/schedule-emitter.ts:25-26,45` | Contrat non respecté : champ `iso` alimenté par `Date.prototype.toString()` et non `toISOString()` | **C** | Produit `"Sat Sep 05 2026 14:44:49 GMT+0200..."`. Incompatible avec les parseurs stricts ISO-8601. |

---

## 3. Analyse Détaillée des Fichiers et Scénarios d'Échec

### 3.1 `src/sensory/system-vitals-emitter.ts`

#### BUG-01 : La métrique `pcpu` de `ps` est un lissage historique (`cputime / etimes`)
- **Lignes** : 48, 203–205, 411.
- **Preuve documentaire (man ps procps)** :
  > `%cpu : cpu utilization of the process in "##.#" format. Currently, it is the CPU time used divided by the time the process has been running (cputime/realtime ratio), expressed as a percentage.`
- **Preuve par exécution live sur l'hôte** :
  Un processus Python maintenu en sommeil 5 secondes puis spinnant à 100 % pendant 1 seconde a été inspecté :
  `ps -p <pid> -o pid=,etime=,cputime=,pcpu=,comm=` a retourné `16.9 %` alors que le CPU instantané était de `100 %`.
- **Scénario d'échec** :
  Un serveur ou un worker en arrière-plan tourne depuis 2h (`7200s`) avec 2 secondes de CPU cumulé. Il part en boucle infinie.
  Au bout de 10 minutes d'emballement continu à 100 % CPU, `pcpu = (2 + 600) / 7800 = 7.7 %`.
  Le seuil `CODEBUDDY_RUNAWAY_CPU_PCT=90` n'est atteint qu'après **18 heures consécutives** à 100 % CPU ($T / (7200 + T) = 0.9 \implies T = 64800\text{ s}$).
  **Conséquence** : La garde est incapable de détecter un emballement survenu sur un processus déjà existant.
- **Correction requise** : Calculer le $\Delta(\text{cputime}) / \Delta(\text{temps})$ entre deux passes consécutives, ou interroger `/proc/<pid>/stat` (champs `utime` + `stime`).

#### BUG-05 : Recyclage de PID
- **Lignes** : 85, 97, 411–414.
- **Mécanisme** : `counters` est une simple `Map<number, number>`. Si le PID 4500 accumule 2 passes, meurt, et que le noyau Linux réattribue le PID 4500 à un nouveau processus 5 secondes plus tard (très courant lors de phases de compilation ou de tests intensifs), ce nouveau processus hérite du compteur `next = 2 + 1 = 3`.
- **Correction requise** : Valider que `child.etimeSec >= (counters.get(child.pid) ?? 0) * intervalleSec`, ou indexer par `(pid, startTime, comm)`.

#### BUG-06 : Purge destructrice sur timeout de `ps`
- **Lignes** : 264–266, 401–404, 433–435.
- **Mécanisme** : En cas de timeout de 5s de `ps`, `readChildren` renvoie `[]`. `livePids` est vide. Ligne 434 : `if (!livePids.has(pid)) counters.delete(pid)` efface tous les compteurs en cours. Un système sous forte charge qui fait déborder un appel `ps` réinitialise donc la détection à zéro.
- **Correction requise** : Ne pas purger les compteurs si la lecture des processus a échoué.

#### BUG-07 : Inefficacité du scope `server` par défaut face aux orphelins
- **Lignes** : 177, 244–263.
- **Mécanisme** : L'incident du 05/09 impliquait des processus laissés par une session d'agent. Quand un agent ou un runner quitte, ses processus enfants sont reparentés par le noyau Linux au PID 1 (`init` ou `systemd --user`). Le parcours d'arbre `scope: 'server'` partant de `process.pid` s'arrête net.
- **Conséquence** : Sans configurer explicitement `CODEBUDDY_RUNAWAY_SCOPE=user`, la garde ne voit absolument pas les processus orphelins.

#### BUG-08 & BUG-09 : Ignorance et impossibilité d'effacer la liste `CODEBUDDY_RUNAWAY_IGNORE_COMM`
- **Lignes** : 180–184, 186–191.
- `resolveIgnoreComm` : `(raw ?? DEFAULT_IGNORE_COMM)...filter(Boolean)`. Si `raw === ""`, `list.length === 0`, la fonction renvoie `DEFAULT_IGNORE_COMM`. Un opérateur ne peut pas vider la liste pour surveiller `python` ou `node`.
- En outre, `python` et `node` font partie de `DEFAULT_IGNORE_COMM`. Si un script Python lancé par un agent boucle à 100 %, il ne sera jamais alerté.
- `c.startsWith(entry)` ignore `python-script.sh` ou `nodemapper` par simple préfixe.

---

### 3.2 `src/sensory/sensory-rules-engine.ts`

#### BUG-03 : Coercion JavaScript `Number(null) === 0`
- **Lignes** : 65–66.
  ```ts
  const n = typeof payloadValue === 'number' ? payloadValue : Number(payloadValue);
  if (!Number.isFinite(n)) return false;
  ```
- **Preuve par exécution** :
  `Number(null)` donne `0`. `Number.isFinite(0)` est `true`.
  `Number(undefined)` donne `NaN`.
- **Scénario d'échec** :
  `ResourceSnapshot` initialise explicitement les champs absents à `null` (`vramPct: null`, `fleetUtilization: null`).
  Si une règle surveille une baisse de VRAM ou d'utilisation de flotte via `{ op: 'lte', value: 10 }` ou `{ op: 'eq', value: 0 }`, la condition est évaluée comme `0 <= 10` ($\implies \text{true}$).
  La règle se déclenche continuellement sur des serveurs qui ne possèdent aucun GPU.
- **Correction requise** :
  ```ts
  if (payloadValue === null || payloadValue === undefined || payloadValue === '') return false;
  ```

#### Vérification de la rétro-compatibilité stricte (string)
- **Ligne 85** : `return String(payloadValue ?? '') === String(filter);`
- La rétro-compatibilité stricte pour les filtres textuels historiques est formellement préservée.

---

### 3.3 `src/sensory/domain-event-bridge.ts` (Point Critique Anti-Boucle)

#### Analyse et Preuve Formelle de Non-Bouclage
- **Question posée** : Un percept ré-émis par le pont peut-il, par un chemin quelconque, re-déclencher le pont (boucle infinie) ?
- **Démonstration de Sûreté** :
  1. **Disjonction stricte des canaux** :
     - Événements écoutés : $E_{in} = \{\text{fleet:activity}, \text{agent:loop\_detected}, \text{cost:updated}, \text{cost:warning}, \text{cost:limit\_reached}, \text{context:pre\_compact}\}$.
     - Événements émis : $E_{out} = \{\text{sensory:perception}\}$.
     - $E_{in} \cap E_{out} = \emptyset$. Le pont n'écoute jamais `sensory:perception`.
  2. **Absence de rebond indirect immédiat** :
     Aucun des composants écoutant `sensory:perception` (`sensory-rules-engine`, `reactions.ts`, `sensory-workspace.ts`) ne ré-émet un événement de $E_{in}$ de manière synchrone.
  3. **Défense en profondeur** :
     La ligne 59 vérifie : `if (incoming?.source === DOMAIN_BRIDGE_SOURCE) return;`. Même si un listener `sensory:perception` était ajouté par erreur dans le pont, la ré-ingestion est court-circuitée.
- **Infalsifiabilité de la source** :
  La source `'domain-bridge'` est un littéral chaîne en mémoire JS. N'importe quel code in-process pourrait forger un événement avec cette source. Cependant, une falsification aurait pour seul effet de *rejeter* l'événement, jamais d'induire une boucle. Le mécanisme est donc intrinsèquement sûr contre l'emballement.

---

### 3.4 `src/sensory/schedule-emitter.ts`

#### BUG-04 : Dérive d'échantillonnage et minutes sautées
- **Lignes** : 39–48, et câblage `src/server/index.ts:1930`.
- **Mécanisme** :
  `CODEBUDDY_SCHEDULE_TICKS_EVERY` vaut 60 battements (cadence ~60s).
  Le template `codex-quota-probe` utilise `filters: { hhmm: '04:20' }` (égalité stricte).
  Si la passe N survient à `04:19:59.5` et que les 60 battements suivants prennent 61 secondes (dû à la latence de traitement des autres organes sur le heartbeat), la passe N+1 survient à `04:21:00.5`.
  `hhmm: '04:20'` n'est **JAMAIS** émis. La tâche planifiée quotidienne est complètement manquée.
- **Correction requise** : Réduire la cadence d'échantillonnage (ex. tous les 20 battements, soit 20s), ou comparer `minuteOfDay >= cible` avec mémorisation du dernier jour d'exécution.

#### BUG-10 : Non-conformité du champ `iso`
- **Lignes** : 25–26, 45.
- `iso: now.toString()` produit une chaîne type locale/RFC 2822 (`"Sat Sep 05 2026 14:44:49 GMT+0200"`), et non une chaîne ISO-8601 (`now.toISOString()`). Tout parseur s'attendant à de l'ISO échouera.

---

### 3.5 `src/sensory/rule-templates.ts` et `sensory-action-executor.ts`

#### BUG-02 : Faux succès silencieux sur l'action `alert`
- **Lignes** : `src/sensory/sensory-action-executor.ts:168–170`.
  ```ts
  case 'alert': {
    const msg = ...;
    await sendTelegramAlert(msg, action.photo === false ? undefined : ctx.imagePath);
    return { ok: true };
  }
  ```
- **Mécanisme** : `sendTelegramAlert` renvoie `false` si `CODEBUDDY_SENSORY_ALERT_TOKEN` ou `CODEBUDDY_SENSORY_ALERT_CHAT` est absent. `executeSensoryAction` ignore ce résultat et renvoie inconditionnellement `{ ok: true }`.
- **Conséquence** :
  1. `[rules] tpl-process-runaway-alert (alert) → ok` est loggué.
  2. `rule-runs.jsonl` consigne `{ ok: true }`.
  3. L'alerte n'a jamais été envoyée, aucun message n'est affiché en console/logs pour suppléer, et l'opérateur est trompé par un faux succès annoncé.
- **Correction requise** :
  ```ts
  const delivered = await sendTelegramAlert(msg, ...);
  if (!delivered) {
    logger.warn(`[sensory] alert not delivered via Telegram: ${msg}`);
    return { ok: false, detail: 'Telegram alert unconfigured or delivery failed' };
  }
  return { ok: true };
  ```

#### Validation des 5 modèles
- Les 5 modèles (`process-runaway-alert`, `disk-low-alert`, `fleet-saturated-alert`, `agent-loop-alert`, `codex-quota-probe`) passent bien la validation structurelle de `validateRule`.
- Cependant, le modèle `codex-quota-probe` lance un agent via `buddy -p`. L'environnement exécuté par `runAgent` (`sensory-action-executor.ts:141`) utilise `buildFilteredSubprocessEnv`, qui élimine toutes les clés d'API ambiantes (`OPENAI_API_KEY`, etc.). Si les clés ne sont pas stockées dans `~/.codebuddy/config.json`, la sous-commande `buddy -p` échouera systématiquement par manque d'authentification.

---

## 4. Angles Transverses

### 4.1 Invariant Never-Throws
- **Prouvé Conforme** :
  - `runSystemVitalsPass` : try/catch global à la ligne 307 protégeant l'ensemble de la passe.
  - `runSchedulePass` : try/catch global retournant `null`.
  - `wireDomainEventBridge` : try/catch interne dans `reemit`.
  - `HeartbeatScheduler` : exécution via `queueMicrotask` enveloppée dans `Promise.resolve().then(...).catch(...)` avec nettoyage garanti dans `finally`.
  - `TypedEventEmitter` : capture des exceptions synchrones et rattachement systématique de `.catch()` sur les retours de promesse des auditeurs.
  Aucune exception ne peut s'échapper pour faire tomber le scheduler ou le serveur.

### 4.2 Opt-In Défaut OFF / Byte-Identique
- **Prouvé Conforme** :
  - Aucun effet de bord (I/O, timer, socket, écoute de bus) à l'importation de l'un quelconque des nouveaux modules.
  - Dans `src/server/index.ts`, les enregistrements sont strictement conditionnés par `process.env.CODEBUDDY_SYSTEM_VITALS === 'true'`, `CODEBUDDY_SCHEDULE_TICKS === 'true'`, et `CODEBUDDY_DOMAIN_EVENTS === 'true'`.
  - Quand ces variables sont absentes ou `false`, aucun listener n'est attaché et aucun traitement n'est enregistré sur le pacemaker.

### 4.3 Concurrence et État Partagé
- **Prouvé Conforme au niveau du scheduler** :
  - Le verrou `inFlight` du `HeartbeatScheduler` est armé de manière synchrone lors de la réception du beat (`onBeat`). Si une passe précédente n'a pas résolu sa promesse, la passe courante est immédiatement ignorée (`continue`). Deux passes de `system-vitals` ne peuvent pas se chevaucher dans le cycle normal du serveur.
  - **Attention** : `moduleRunawayCounters` est une `Map` singleton au niveau du module `system-vitals-emitter.ts`. Des appels concurrents hors du scheduler (ex. invocation CLI concurrente ou tests sans reset) interféreraient sur cet état.

---

## 5. Recommandations de Correction Immédiate

1. **Remplacer la lecture `pcpu` de `ps` par un vrai calcul delta** :
   Mesurer la différence de temps processeur ($\Delta \text{cputime}$) divisée par le temps écoulé ($\Delta t$) entre deux passes pour chaque PID, ou lire `/proc/<pid>/stat`.
2. **Propager l'échec de livraison dans `executeSensoryAction('alert')`** :
   Renvoyer `{ ok: false, detail: 'telegram unconfigured / failed' }` lorsque `sendTelegramAlert` renvoie `false`, et logger l'alerte sur la console/logger local en repli.
3. **Corriger le guard de filtre numérique dans `filterMatches`** :
   Ajouter `if (payloadValue === null || payloadValue === undefined || payloadValue === '') return false;` avant `Number(payloadValue)`.
4. **Sécuriser la détection des minutes dans `schedule-emitter`** :
   Passer la cadence par défaut à 20 ou 30 battements (pour respecter la fréquence de Nyquist vis-à-vis d'une fenêtre d'une minute), et tolérer une comparaison de minute mémorisée.
5. **Défense PID recycling** :
   Vérifier que le temps de vie du processus (`etimeSec`) est au moins égal au produit `passes * intervalle`.
6. **Autoriser la purge de `CODEBUDDY_RUNAWAY_IGNORE_COMM`** :
   Distinguer `undefined` (défaut) d'une chaîne vide explicitement configurée (`""` $\implies$ aucun processus ignoré).
