# Surveillance événementielle (au lieu de boucles occupées)

Code Buddy surveille les ressources et l'heure de façon **événementielle** — cadencée par le
battement de cœur du système nerveux — plutôt que par des boucles occupées. Une boucle `while`
qui sonde le CPU consomme un cœur en continu ; ici, une seule **mesure par battement** suffit, et
le verrou `inFlight` du pacemaker garantit qu'une passe lente ne se chevauche jamais. C'est la
réponse directe à l'incident du 05/09 (trois `bash` collés à 99,9 % de CPU pendant 2 h 30).

Tout est **opt-in, défaut OFF** : sans les variables d'environnement ci-dessous, le comportement
est byte-identique.

## Le flux : battement → percept → règle → action

```
buddy-sense (vital.rs)  ──beat/s──▶  HeartbeatScheduler (pacemaker)
        ▲  (si absent, pacemaker TS opt-in CODEBUDDY_HEARTBEAT_FALLBACK)
                                          │  (tous les N battements)
                          ┌───────────────┼────────────────────┐
                          ▼                                      ▼
           system-vitals-emitter.ts                    schedule-emitter.ts
     (lit memory/gpu/fleet/disk + /proc)           (émet l'heure courante)
                          │  emit('sensory:perception')          │
                          ▼                                      ▼
                    Bus d'événements  (modality:'system' | 'time')
                                          │
                                          ▼
                    sensory-rules-engine.ts  (ruleMatches + seuils)
                                          │  (cooldown, plafonds, audit)
                                          ▼
              action : alert · shell borné · agent · webhook loopback · kill_process (opt-in)
```

- **Émetteur de signes vitaux** (`src/sensory/system-vitals-emitter.ts`) : à chaque passe, lit les
  moniteurs EXISTANTS (aucune nouvelle mesure) et émet des percepts `modality:'system'` :
  - `resource_threshold` — un pouls portant tout le snapshot (`rssMb`, `heapUsedMb`, `load1`,
    `vramPct`, `diskPct` = % **utilisé**, `fleetUtilization`…). C'est la cible des règles à seuil.
  - `disk_low` — disque utilisé ≥ `CODEBUDDY_DISK_LOW_PCT` (défaut 90).
  - `fleet_saturated` — capacité flotte atteinte.
  - `process_runaway` — un processus au-dessus de `CODEBUDDY_RUNAWAY_CPU_PCT` (défaut 90) pendant
    `CODEBUDDY_RUNAWAY_PASSES` passes CONSÉCUTIVES (défaut 3). Le payload porte `pid`, `ppid`,
    `comm`, `pcpu` / `pcpuTotal` (somme des cœurs, 100 % = un cœur plein — un process 8 threads
    saturés = 800 %), `pcpuOfMachine` (`pcpuTotal / nproc`), `cores` (nproc), `etimeSec`,
    `startTime` (champ 22 de `/proc/<pid>/stat`, anti réutilisation de PID) et
    `scope`. Le seuil reste sur `pcpuTotal` (compat) ; `CODEBUDDY_RUNAWAY_CPU_BASIS=machine`
    le compare à `pcpuOfMachine` (défaut `core` = byte-identique).
    **CPU instantané** : le seuil s'applique au CPU INSTANTANÉ, calculé par delta de
    `/proc/<pid>/stat` (utime+stime en jiffies) entre deux passes — PAS la moyenne `ps pcpu`
    (qui est `cputime/vie` et mettrait des heures à franchir 90 % pour un vieux processus qui
    s'emballe). Un pid vu pour la 1re fois n'a pas de delta (il ne compte pas cette passe) ; un
    changement de `startTime` (réutilisation de PID) réinitialise le compteur.
    **Portée de scan** (`CODEBUDDY_RUNAWAY_SCOPE`) : `server` (défaut, conservateur) ne regarde que
    les descendants du serveur ; `user` regarde TOUS les processus de l'utilisateur. **`user` est
    requis** pour attraper (a) les boucles nées hors du serveur (session CLI — le cas de l'incident
    du 05/09) et (b) les orphelins reparentés à PID 1 quand leur parent meurt : `server` s'arrête à
    l'arbre du serveur et ne les voit pas. En mode `user`, la liste d'exceptions
    `CODEBUDDY_RUNAWAY_IGNORE_COMM` est **indispensable** : elle empêche les processus légitimement
    gourmands (ffmpeg, ComfyUI/python, node de build/vitest, tsc, cargo, rustc…) de déclencher une
    fausse alerte. Comparaison par `comm` EXACT (jamais par préfixe), et `CODEBUDDY_RUNAWAY_IGNORE_COMM=""`
    vide la liste (ne rien ignorer). Un échec de lecture `/proc` NE purge PAS les compteurs (pas de
    remise à zéro sur un timeout transitoire).
- **Déclencheur horaire** (`src/sensory/schedule-emitter.ts`) : émet un percept `time/tick`
  (`hhmm`, `weekday`, `iso`, `minuteOfDay`) à chaque passe, pour des règles à l'heure.
- **Battement TS de repli** (`src/sensory/heartbeat-fallback.ts`) : si le daemon Rust
  `buddy-sense` n'est pas connecté, le scheduler ne bat pas et la surveillance est muette.
  Opt-in `CODEBUDDY_HEARTBEAT_FALLBACK=true` : un `setInterval` (`unref()`, période
  `CODEBUDDY_HEARTBEAT_FALLBACK_MS`, défaut 1000) émet le même percept `vital/heartbeat`.
  Un battement réel (`source` ≠ `heartbeat-fallback`) coupe l'intervalle immédiatement ; il
  se réarme après `CODEBUDDY_HEARTBEAT_FALLBACK_SILENCE_MS` (défaut 15000) de silence.
  Jamais deux horloges. Teardown dans `stopServer`. Défaut OFF = aucun timer.
- **Moteur de règles** (`src/sensory/sensory-rules-engine.ts`) : les filtres acceptent l'égalité
  string historique ET une forme numérique `{op:'gt'|'gte'|'lt'|'lte'|'eq'|'ne', value:number}`
  comparée à `payload[clé]`.
- **CLI** `buddy sensory status [--json]` : lecture seule (flags, source du battement rust /
  fallback / aucun, cadence des traitements, 5 dernières perceptions `system`/`time`, règles
  + dernier déclenchement d'après `rule-runs.jsonl`). Sans serveur : lit les fichiers d'état
  s'ils existent, sinon « serveur non joignable ».

## Activer

```bash
# Serveur avec surveillance système + horaire + moteur de règles
CODEBUDDY_SENSORY=true \
CODEBUDDY_SYSTEM_VITALS=true \
CODEBUDDY_SCHEDULE_TICKS=true \
CODEBUDDY_SENSORY_RULES=true CODEBUDDY_SENSORY_TOKEN=<token> \
CODEBUDDY_HEARTBEAT_FALLBACK=true \   # optionnel : pacemaker TS si buddy-sense absent
buddy server

buddy sensory status                 # inspection lecture seule
buddy sensory status --json
```

## Installer une règle-modèle

Des règles prêtes à l'emploi (validées par `validateRule`) sont livrées ; aucune n'est active tant
que non installée :

```bash
buddy rules templates                              # liste les modèles
buddy rules add --template process-runaway-alert   # le correctif de l'incident
buddy rules add --template process-runaway-kill    # remédiation bornée (dry-run par défaut)
buddy rules add --template disk-low-alert          # diskPct >= 90 -> alerte
buddy rules add --template fleet-saturated-alert
buddy rules add --template codex-quota-probe       # tick 04:20 -> agent
buddy rules list                                   # vérifier
```

Exemple de règle à seuil (installée par `disk-low-alert`) :

```json
{
  "id": "tpl-disk-low-alert",
  "match": { "modality": "system", "kind": "resource_threshold",
             "filters": { "diskPct": { "op": "gte", "value": 90 } } },
  "action": { "type": "alert", "message": "Disque plein à >= 90 %." },
  "cooldownMs": 1800000
}
```

## Variables d'environnement

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `CODEBUDDY_SYSTEM_VITALS` | (off) | `true` active l'émetteur de signes vitaux système |
| `CODEBUDDY_SYSTEM_VITALS_EVERY` | `30` | Cadence en battements de l'émetteur système |
| `CODEBUDDY_RUNAWAY_CPU_PCT` | `90` | Seuil CPU d'un processus « emballé » (sur `pcpuTotal`, % d'un cœur) |
| `CODEBUDDY_RUNAWAY_CPU_BASIS` | `core` | `core` = seuil sur `pcpuTotal` (compat) ; `machine` = seuil sur `pcpuOfMachine` |
| `CODEBUDDY_RUNAWAY_PASSES` | `3` | Passes consécutives au-dessus du seuil avant `process_runaway` |
| `CODEBUDDY_RUNAWAY_SCOPE` | `server` | Portée du scan : `server` (descendants du serveur) ou `user` (tous les processus de l'utilisateur — attrape les boucles hors serveur) |
| `CODEBUDDY_RUNAWAY_IGNORE_COMM` | ffmpeg,comfyui,python,python3,node,tsc,vitest,cargo,rustc,esbuild | csv des `comm` légitimement gourmands qui ne déclenchent jamais `process_runaway` (indispensable en mode `user`) |
| `CODEBUDDY_RUNAWAY_KILL` | (off) | `true` arme un `kill` réel pour l'action `kill_process`. Double opt-in : la règle doit aussi porter `dryRun:false`. Défaut = dry-run (journalise, n'envoie aucun signal). Le pid vient UNIQUEMENT du percept `process_runaway` (jamais d'un pid dans la règle). Avant le signal : le pid doit encore exister, `comm`+`startTime` identiques au percept, pas le serveur, pas un ancêtre, pas pid 1, pas un autre uid. `SIGTERM` puis `SIGKILL` seulement si `escalate:true` (après `graceMs`, défaut 5000, borné 1000–60000). Jamais de pid négatif ni de groupe. Après l'action : percept `process_remediated` (`pid`, `comm`, `signal`, `dryRun`, `ok`, `reason`) — une règle `alert` sur ce kind notifie la remédiation comme `tpl-process-runaway-alert` notifie la détection. |
| `CODEBUDDY_DISK_LOW_PCT` | `90` | Seuil de disque utilisé pour `disk_low` |
| `CODEBUDDY_SCHEDULE_TICKS` | (off) | `true` active l'émetteur horaire (`time/tick`) |
| `CODEBUDDY_SCHEDULE_TICKS_EVERY` | `20` | Cadence en battements de l'émetteur horaire (≈ 3/min, fenêtre anti-gigue) |
| `CODEBUDDY_DOMAIN_EVENTS` | (off) | `true` re-émet les événements de domaine (`fleet:activity`, `cost:*`, …) sur le bus sensoriel |
| `CODEBUDDY_HEARTBEAT_FALLBACK` | (off) | `true` active le pacemaker TS si `buddy-sense` n'émet rien |
| `CODEBUDDY_HEARTBEAT_FALLBACK_MS` | `1000` | Période du pacemaker TS (`unref()`) |
| `CODEBUDDY_HEARTBEAT_FALLBACK_SILENCE_MS` | `15000` | Silence d'un battement réel avant de réarmer le repli |

Les actions déclenchées héritent des garde-fous existants du moteur de règles : plafonds
(`CODEBUDDY_RULE_MAX_IN_FLIGHT` / `CODEBUDDY_RULE_MAX_FIRES_PER_SEC`), garde `isDestructive`, token
requis, audit `rule-runs.jsonl`, rechargement à chaud.
