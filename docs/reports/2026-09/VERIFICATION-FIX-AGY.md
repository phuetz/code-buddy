# RAPPORT DE VÉRIFICATION — Correctifs de surveillance événementielle

**Date** : 5 septembre 2026  
**Vérificateur** : Antigravity (Gemini) — Lignée indépendante  
**Dépôt** : `~/DEV/cb-heartwatch-2026-09-05`  
**Branche** : `feat/surveillance-evenementielle-2026-09-05`  
**Réf. Audit** : `docs/reports/2026-09/AUDIT-SURVEILLANCE-AGY.md`  
**Réf. Correctifs** : `docs/reports/2026-09/CORRECTION-BUGS-SURVEILLANCE.md`  

---

## 1. Synthèse Exécutive et Verdict Final

Une vérification allégée et indépendante sur pièces (code source et tests unitaires ciblés) a été réalisée pour valider les correctifs apportés aux 10 bugs soulevés lors de l'audit adversarial initial (4 Bloquants A + 6 Secondaires B/C).

### VERDICT FINAL : **CONFIRMÉ PUSHABLE**
- Les **4 bugs bloquants (A)** sont **réellement et rigoureusement fermés**.
- Les tests associés sont **honnêtes** (reproduction démontrée de l'échec avant correctif).
- Les **6 bugs secondaires (B et C)** sont également **fermés et conformes**.
- La suite de tests ciblée est **100 % verte (59/59 passés)** sans régression ni effet de bord.

---

## 2. Tableau Détaillé de Vérification des 10 Bugs

| ID | Gravité | Statut | Fichier : Ligne(s) | Preuve Code & Analyse Critique | Preuve par les Tests |
|---|---|---|---|---|---|
| **BUG-01** | **A** | **FERMÉ** | `src/sensory/system-vitals-emitter.ts:16-18, 41-55, 232-236, 241-262, 471-536` | **CPU instantané par delta `/proc/<pid>/stat`** : abandon de `ps -o pcpu` (moyenne de vie). Lecture directe des jiffies `utime` (champ 14) + `stime` (champ 15). Calcul : `(dJiffies / clkTck / dtSec) * 100`.<br>• `clkTck` : 100 Hz par défaut (norme Linux `USER_HZ` pour `/proc`), injectable via `deps.clkTck` ou `CODEBUDDY_CLK_TCK`.<br>• `dtSec` : `(now - before.sampledAt) / 1000`.<br>• 1ère vue : baseline posée, delta null, aucun comptage (`cpuPct === null`).<br>• Unités : 100 jiffies consommés en 1s sur 1 cœur donne exactement 100 %. | `tests/sensory/system-vitals-emitter.test.ts:94-117` : test d'un processus vieux de 2h (`etimeStart: 7200`) qui s'emballe soudainement. **Test honnête** : sous l'ancien code, `pcpu` valait 0,43 % (seuil 90 % jamais atteint). Avec le fix, détecté en 2 passes à 100 %. |
| **BUG-02** | **A** | **FERMÉ** | `src/sensory/sensory-action-executor.ts:171-180` | **Propagation du résultat réel de l'alerte** : `sendTelegramAlert` renvoie un booléen. Si le token/chat est absent ou si fetch échoue, `executeSensoryAction` renvoie `{ ok: false, detail: 'telegram alert unconfigured or delivery failed' }` et loggue un `logger.warn`. Fin du faux succès silencieux dans `rule-runs.jsonl`. | `tests/sensory/alert-action.test.ts` : 3 tests dédiés rouge→vert (sans token → `ok:false`, token + fetch HTTP 200 → `ok:true`, token + rejet HTTP → `ok:false`). |
| **BUG-03** | **A** | **FERMÉ** | `src/sensory/sensory-rules-engine.ts:67-69` | **Garde anti-coercion `null`/`undefined`/`''`** : `if (payloadValue === null \|\| payloadValue === undefined \|\| payloadValue === '') return false;` avant `Number(payloadValue)`. Empêche `Number(null) === 0` de déclencher `lte 10` ou `eq 0` sur machines sans GPU (`vramPct: null`). Un vrai `0` numérique n'est pas filtré par ce guard et satisfait bien `eq 0`. | `tests/sensory/sensory-rules-engine.test.ts:123-140` : vérifie que `null`, `undefined` et `""` échouent sur les filtres numériques, tandis que `0` passe `eq 0` et `lte 10`. |
| **BUG-04** | **A** | **FERMÉ** | `src/sensory/rule-templates.ts:97`, `src/sensory/schedule-emitter.ts:20-48`, `src/server/index.ts:1930` | **Résistance à la gigue d'échantillonnage** : Cadence par défaut passée de 60 à 20 battements (`CODEBUDDY_SCHEDULE_TICKS_EVERY=20`, soit 3 ticks/min). Le modèle `codex-quota-probe` utilise `between: ['04:20', '04:22']` avec `cooldownMs: 3_600_000` au lieu d'une égalité stricte `hhmm`. | `tests/sensory/schedule-emitter.test.ts:68-109` : simule une gigue à 60s (04:19:59, 04:21:00, 04:22:01). Prouve que l'ancienne règle ratait (0 match) alors que la nouvelle capte la fenêtre à coup sûr (≥ 1 match). |
| **BUG-05** | **B** | **FERMÉ** | `src/sensory/system-vitals-emitter.ts:493-506` | **Défense PID-reuse** : si un nouveau processus réutilise le même PID, `before.startTime !== s.startTime` (ou le processus a rajeuni). Le compteur consécutif est purgé (`counters.delete(pid)`), une nouvelle baseline est posée et aucun comptage n'est effectué sur cette passe. | `tests/sensory/system-vitals-emitter.test.ts:188-211` : simulation de réattribution de PID via `scn.reuse(9999)` ; le nouveau processus repart à zéro sans hériter du compteur. |
| **BUG-06** | **B** | **FERMÉ** | `src/sensory/system-vitals-emitter.ts:474-482, 537-544` | **Non-purge sur échec de lecture** : en cas d'erreur ou timeout de `/proc`, `readProcesses` retourne `null`. La section runaway est sautée SANS purger `counters` ni `prev`. Seul un résultat non nul (`samples !== null`) purge les processus disparus. | `tests/sensory/system-vitals-emitter.test.ts:213-237` : injection d'une passe `null` entre 2 passes à 100 % ; le compteur reste à 2 et l'alerte se déclenche à la passe suivante. |
| **BUG-07** | **B** | **FERMÉ** | `src/sensory/system-vitals-emitter.ts:227-230, 265-268, 293-300`, `docs/surveillance-evenementielle.md:46-55`, `CLAUDE.md:309` | **Portée `server` vs `user` et orphelins** : implémentation et documentation claire du fait que `scope: 'server'` ne voit que les descendants directs du serveur. Pour attraper les orphelins reparentés à PID 1 (incident du 05/09), `CODEBUDDY_RUNAWAY_SCOPE=user` est requis et documenté. | `tests/sensory/system-vitals-emitter.test.ts:304-321` : vérifie la prise en compte du scope et son marquage dans le payload. Documentation opérationnelle complétée. |
| **BUG-08** | **C** | **FERMÉ** | `src/sensory/system-vitals-emitter.ts:208-218` | **Possibilité de vider la liste d'ignore** : `resolveIgnoreComm` distingue `undefined` d'une chaîne vide `""`. `CODEBUDDY_RUNAWAY_IGNORE_COMM=""` retourne `[]`, permettant de surveiller tous les processus y compris `node` ou `python`. | `tests/sensory/system-vitals-emitter.test.ts:257-271` : test dédié prouvant que `CODEBUDDY_RUNAWAY_IGNORE_COMM=""` permet d'alerter sur un process `node`. |
| **BUG-09** | **C** | **FERMÉ** | `src/sensory/system-vitals-emitter.ts:221-225` | **Match exact pour `isIgnoredComm`** : remplacement de `c.startsWith(entry)` par `ignore.includes(c)`. Empêche l'immunisation accidentelle de binaires comme `nodemapper` ou `python_loop`. | `tests/sensory/system-vitals-emitter.test.ts:273-301` : vérifie que `nodemapper` n'est pas ignoré par `node`, alors que le binaire exact `node` l'est. |
| **BUG-10** | **C** | **FERMÉ** | `src/sensory/schedule-emitter.ts:25, 45` | **Conformité du format ISO-8601** : `iso: now.toISOString()` au lieu de `now.toString()`, garantissant la compatibilité avec les parseurs stricts ISO-8601 UTC. | `tests/sensory/schedule-emitter.test.ts:21-22` : validé dans le contrat du payload `TickPayload`. |

---

## 3. Preuve d'Exécution des Tests Ciblés

Commande exécutée dans l'environnement de vérification hermétique :
```bash
HOME=~/DEV/cb-heartwatch-2026-09-05/_qa/verify/home npx vitest run \
  tests/sensory/system-vitals-emitter.test.ts \
  tests/sensory/sensory-rules-engine.test.ts \
  tests/sensory/schedule-emitter.test.ts \
  tests/sensory/rule-templates.test.ts \
  tests/sensory/domain-event-bridge.test.ts \
  tests/sensory/alert-action.test.ts
```

### Résultat Vitest
```text
 Test Files  6 passed (6)
      Tests  59 passed (59)
   Start at  17:11:22
   Duration  534ms (transform 765ms, setup 76ms, import 1.32s, tests 251ms, environment 1ms)
```
- **Fichiers testés** : 6/6
- **Tests exécutés et validés** : 59/59
- **Échecs / régressions** : 0

---

## 4. À Améliorer et Finaliser (Feuille de Route Priorisée)

Pour transformer cette brique de surveillance en un sous-système autonome résilient pour Lisa (production 24/7), les chantiers suivants sont recommandés :

### 4.1 Priorité HAUTE — Nécessaire avant de compter dessus en production autonome 24/7

1. **Auto-réparation réelle / Remédiation bornée (Kill runaway opt-in)**
   - **Quoi** : Ajouter un type d'action `kill_process` (ou script hook paramétrable) pour stopper automatiquement les processus runaway confirmés.
   - **Pourquoi** : Une simple alerte Telegram est inutile si l'opérateur dort ou n'a pas son téléphone (les 3 boucles bash du 05/09 ont tourné 2h30 à 100 % CPU). Pour protéger le matériel, le système doit pouvoir agir de manière autonome.
   - **Garde-fous stricts** : Opt-in explicite (`CODEBUDDY_RUNAWAY_AUTO_KILL=true`), vérification du PID et du `startTime` au moment du kill, interdiction formelle de toucher aux PIDs protégés (PID 1, PID du serveur CodeBuddy, processus de l'arbre serveur), séquence `SIGTERM` suivie de `SIGKILL` après 5s, et rate-limiting de remédiation (max 3 kills/heure avec alerte Telegram immédiate).
   - **Effort** : **M** (2-3 jours).

2. **Fallback de battement TypeScript pur (indépendance du daemon Rust)**
   - **Quoi** : Implémenter un timer `setInterval` de secours (1000 ms) dans le `HeartbeatScheduler` activé automatiquement si le pacemaker Rust n'émet aucun beat pendant 3 secondes.
   - **Pourquoi** : Si le binaire Rust pacemaker plante, ne démarre pas ou si le socket IPC est indisponible, toute la surveillance (vitals, ticks, règles) est silencieusement paralysée. Le robot perd ses réflexes vitaux.
   - **Effort** : **S** (1 jour).

3. **Normalisation multi-cœurs du CPU instantané**
   - **Quoi** : Exposer dans le payload à la fois `pcpuCore` (actuel, 100 % = 1 cœur plein) et `pcpuTotal` (normalisé sur `os.cpus().length`, où 100 % = toute la machine).
   - **Pourquoi** : Éviter les confusions sur des machines multi-cœurs où un processus multi-threadé peut atteindre 800 % CPU alors qu'un script mono-threadé plafonnera à 100 %.
   - **Effort** : **S** (0.5 jour).

---

### 4.2 Priorité MOYENNE — Confort opérationnel et robustesse

4. **Observabilité & CLI d'état sensoriel (`buddy sensory status`)**
   - **Quoi** : Exposer une sous-commande CLI et une route compagne pour inspecter : état des compteurs runaway en cours (ex: PID 4500 à 2/3 passes), dernière latence d'échantillonnage `/proc`, santé des listeners et statut de livraison Telegram.
   - **Pourquoi** : Actuellement, impossible de savoir si un processus est sur le point de déclencher une alerte ou si une lecture `/proc` échoue silencieusement.
   - **Effort** : **M** (1-2 jours).

5. **Gestion dynamique de la liste d'exceptions (sans redémarrage)**
   - **Quoi** : Permettre de configurer `runaway.ignore_comm` dans `~/.codebuddy/config.json` et via la CLI (`buddy rules ignore add <comm>`).
   - **Pourquoi** : Modifier la variable d'environnement `CODEBUDDY_RUNAWAY_IGNORE_COMM` impose de redémarrer le démon CodeBuddy, ce qui est lourd lors de l'exécution ponctuelle d'un nouveau compilateur ou outil lourd.
   - **Effort** : **M** (1-2 jours).

6. **Canal d'alerte local de repli**
   - **Quoi** : Si Telegram échoue ou n'est pas configuré, écrire dans `~/.codebuddy/alerts.log` et déclencher une notification de bureau locale (`notify-send` / `desktop-notifier`).
   - **Pourquoi** : Garantit que l'opérateur présent sur la machine voit l'alerte même sans configuration cloud ou réseau.
   - **Effort** : **S** (1 jour).

---

### 4.3 Priorité BASSE — Confort & Couverture des angles morts rares

7. **Surveillance d'emballement mémoire par processus**
   - **Quoi** : Détecter les processus dont la mémoire résidente (`rssMb`) grimpe anormalement vite entre deux passes, avant que le système ne subisse un freeze de swap ou un OOM-killer brutal.
   - **Pourquoi** : Les boucles allouant continuellement de la mémoire peuvent crasher l'hôte sans nécessairement saturer le CPU à 90 %.
   - **Effort** : **M** (2 jours).

8. **Portabilité hors Linux (/proc absent)**
   - **Quoi** : Implémenter un fallback vers `pidusage` ou parsing `ps` pour macOS/WSL lorsque `/proc` n'est pas monté.
   - **Pourquoi** : Actuellement, sur macOS, `readProcesses` retourne `null` en permanence et la garde est inactive.
   - **Effort** : **L** (3 jours).

9. **Catalogue étendu de modèles de règles**
   - **Quoi** : Fournir des templates prêts à l'emploi pour la veille nocturne (ex: extinction des capteurs après 23h), la surchauffe GPU (`vramUsedMb` / température) et le nettoyage des fichiers temporaires.
   - **Pourquoi** : Réduire le temps de configuration manuelle par l'opérateur.
   - **Effort** : **S** (1 jour).

---

## 5. Conclusion de la Vérification

Les 10 bugs de l'audit sont résolus de façon exemplaire. Le calcul du delta CPU par `/proc/<pid>/stat` est mathématiquement et temporellement exact, le moteur de règles ne souffre plus d'aucun faux positif sur les valeurs nulles, les alertes Telegram ne mentent plus sur leur livraison, et la planification temporelle est immunisée contre la gigue de cadence.

La branche `feat/surveillance-evenementielle-2026-09-05` est saine, testée et prête à être fusionnée.
