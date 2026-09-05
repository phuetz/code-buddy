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
                                          │  (tous les N battements)
                          ┌───────────────┼────────────────────┐
                          ▼                                      ▼
           system-vitals-emitter.ts                    schedule-emitter.ts
     (lit memory/gpu/fleet/disk + ps)              (émet l'heure courante)
                          │  emit('sensory:perception')          │
                          ▼                                      ▼
                    Bus d'événements  (modality:'system' | 'time')
                                          │
                                          ▼
                    sensory-rules-engine.ts  (ruleMatches + seuils)
                                          │  (cooldown, plafonds, audit)
                                          ▼
              action : alert · shell borné · agent · webhook loopback
```

- **Émetteur de signes vitaux** (`src/sensory/system-vitals-emitter.ts`) : à chaque passe, lit les
  moniteurs EXISTANTS (aucune nouvelle mesure) et émet des percepts `modality:'system'` :
  - `resource_threshold` — un pouls portant tout le snapshot (`rssMb`, `heapUsedMb`, `load1`,
    `vramPct`, `diskPct` = % **utilisé**, `fleetUtilization`…). C'est la cible des règles à seuil.
  - `disk_low` — disque utilisé ≥ `CODEBUDDY_DISK_LOW_PCT` (défaut 90).
  - `fleet_saturated` — capacité flotte atteinte.
  - `process_runaway` — un processus au-dessus de `CODEBUDDY_RUNAWAY_CPU_PCT` (défaut 90) pendant
    `CODEBUDDY_RUNAWAY_PASSES` passes CONSÉCUTIVES (défaut 3). Le payload porte `pid`, `ppid`,
    `comm`, `pcpu`, `etimeSec` et `scope` (pour savoir quel processus arrêter).
    **Portée de scan** (`CODEBUDDY_RUNAWAY_SCOPE`) : `server` (défaut, conservateur) ne regarde que
    les descendants du serveur ; `user` regarde TOUS les processus de l'utilisateur — c'est le mode qui
    aurait attrapé l'incident du 05/09, dont les boucles étaient nées dans la session CLI (hors de
    l'arbre du serveur). En mode `user`, la liste d'exceptions `CODEBUDDY_RUNAWAY_IGNORE_COMM` est
    **indispensable** : elle empêche les processus légitimement gourmands (ffmpeg, ComfyUI/python,
    node de build/vitest, tsc, cargo, rustc…) de déclencher une fausse alerte.
- **Déclencheur horaire** (`src/sensory/schedule-emitter.ts`) : émet un percept `time/tick`
  (`hhmm`, `weekday`, `iso`, `minuteOfDay`) à chaque passe, pour des règles à l'heure.
- **Moteur de règles** (`src/sensory/sensory-rules-engine.ts`) : les filtres acceptent l'égalité
  string historique ET une forme numérique `{op:'gt'|'gte'|'lt'|'lte'|'eq'|'ne', value:number}`
  comparée à `payload[clé]`.

## Activer

```bash
# Serveur avec surveillance système + horaire + moteur de règles
CODEBUDDY_SENSORY=true \
CODEBUDDY_SYSTEM_VITALS=true \
CODEBUDDY_SCHEDULE_TICKS=true \
CODEBUDDY_SENSORY_RULES=true CODEBUDDY_SENSORY_TOKEN=<token> \
buddy server
```

## Installer une règle-modèle

Des règles prêtes à l'emploi (validées par `validateRule`) sont livrées ; aucune n'est active tant
que non installée :

```bash
buddy rules templates                              # liste les modèles
buddy rules add --template process-runaway-alert   # le correctif de l'incident
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
| `CODEBUDDY_RUNAWAY_CPU_PCT` | `90` | Seuil CPU d'un processus « emballé » |
| `CODEBUDDY_RUNAWAY_PASSES` | `3` | Passes consécutives au-dessus du seuil avant `process_runaway` |
| `CODEBUDDY_RUNAWAY_SCOPE` | `server` | Portée du scan : `server` (descendants du serveur) ou `user` (tous les processus de l'utilisateur — attrape les boucles hors serveur) |
| `CODEBUDDY_RUNAWAY_IGNORE_COMM` | ffmpeg,comfyui,python,python3,node,tsc,vitest,cargo,rustc,esbuild | csv des `comm` légitimement gourmands qui ne déclenchent jamais `process_runaway` (indispensable en mode `user`) |
| `CODEBUDDY_DISK_LOW_PCT` | `90` | Seuil de disque utilisé pour `disk_low` |
| `CODEBUDDY_SCHEDULE_TICKS` | (off) | `true` active l'émetteur horaire (`time/tick`) |
| `CODEBUDDY_SCHEDULE_TICKS_EVERY` | `60` | Cadence en battements de l'émetteur horaire (≈ 1/min) |

Les actions déclenchées héritent des garde-fous existants du moteur de règles : plafonds
(`CODEBUDDY_RULE_MAX_IN_FLIGHT` / `CODEBUDDY_RULE_MAX_FIRES_PER_SEC`), garde `isDestructive`, token
requis, audit `rule-runs.jsonl`, rechargement à chaud.
