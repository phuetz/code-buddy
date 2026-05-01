# HEARTBEAT.md — Checklist du fleet autonome

> **Lu à chaque tick** par `tools/heartbeat_tick.py` sur chaque host.
> Si la première ligne après le titre est `FLEET_PAUSE`, tous les Claudes du fleet s'arrêtent jusqu'à reset.

## Phase active : V0 — DARKSTAR seul, tâche test

## À surveiller (chaque tick, dans cet ordre)

1. **`colab-tasks.json`** : y a-t-il des tâches `status=open` et `claimedBy=null` ?
   - Si oui → claim la 1ère selon priority (critical > high > medium > low) et exécute.
   - Si non → réponds `HEARTBEAT_OK` et exit.
2. **`presence.json`** : un host avec `lastSeen > 1h ago` et tâche `status=in_progress` à son nom ?
   - Si oui → soft-rescue : commenter dans `colab-worklog.json` que tu as détecté l'orphelin. Ne pas reclaim auto en V0 (risque d'étouffer un long process). Patrice arbitrera.
3. **Branches `feat/*`** ouvertes sans activité > 24h sur `phuetz/code-buddy` ou `phuetz/world-model` ? (Hors scope V0, juste log si détecté.)

## Règles d'action autonome (héritées du COLAB-RESEAU v0.2)

```
F1 — Une tâche en parallèle = un IA owner. Pas d'intervention sans claim.
F2 — Tout commit/push sur claude-et-patrice doit être précédé d'un git pull --rebase.
F3 — Avant d'écrire dans un journal qui n'est pas le sien, demander.
F4 — Les "propositions/" sont datées + auteur + host. Validation Patrice.
F5 — Sur tâche déléguée à un autre Claude : laisser un fichier d'output convenu.
F6 — Les locales (3090, NPU, iGPU) sont consommables : surveiller VRAM/RAM avant gros job.
```

**Spécifique V0 wrapper** :
- **Max 1 tâche par tick.** Pas de rafale. Le tick suivant prendra la suivante.
- **Output JSON obligatoire** en dernière ligne du `claude --print` : `{"summary":..., "files_modified":[{"file":..., "changes":...}], "issues":[...], "next_steps":[...]}`. Le wrapper parse ça pour nourrir le worklog.
- **Si la tâche dérive hors scope** (modifie un fichier non dans `filesToModify`) : rollback (`git checkout -- .`) + status="blocked" + commit + push avec issue documentée.
- **Timeout dur 600s** sur l'invoke claude. Au-delà → status="blocked".

## Suppressions

Si rien à faire, le wrapper log `HEARTBEAT_OK` dans `heartbeat.log`. Après **5 suppressions consécutives**, le tick suivant doit faire un "full review" : lire les 5 derniers commits du repo, repérer si quelque chose a été oublié, soit log `HEARTBEAT_OK` à nouveau, soit ajouter une proposition dans `propositions/`.

## FLEET_PAUSE

Si la 1ère ligne après le titre `# HEARTBEAT.md` ci-dessus contient le mot `FLEET_PAUSE`, tous les Claudes s'arrêtent au prochain tick et restent silent jusqu'à reset par Patrice. Mécanisme d'arrêt d'urgence si une boucle dérive ou si Patrice veut figer le repo.

## Statut V0

- DARKSTAR (Windows 11, claude.exe 2.1.126) : wrapper `tools/heartbeat_tick.py` actif sur Task Scheduler 30min (à confirmer)
- MINISTAR Windows : pas encore activé V0
- Ministar Linux : pas encore activé V0 (mais hub A2A actif depuis 21:51 CEST 1er mai)

— Bootstrap par Claude/DARKSTAR, 2026-05-02 ~01h
