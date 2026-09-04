# Réparation SWARMFIX1

Date : 2026-09-04
Branche : `fix/swarmfix1-2026-09-04`

## Périmètre

- Réparer ou réaligner le test `tests/unit/swarm-handler.test.ts` selon le contrat actuel de `/swarm`.
- Identifier et rendre hermétique le test de `tests/unit` qui écrit dans `.codebuddy/agent-memory/alice/MEMORY.md`.

## État initial

Rapport créé avant toute inspection du dépôt. Les constats, modifications, commits et preuves seront complétés pendant l'intervention.

## Point 1 — `/swarm` et DELEG2

Le contrat DELEG2 est le nouveau chemin voulu : `/swarm <tâche>` appelle
`/agents run <tâche>` avec une option `threadDelegation` contenant la
concurrence, le budget parent et le flux d'événements. L'override de stratégie
reste `parallel` pendant l'appel et est restauré ensuite. Le test unitaire
attendait l'ancienne signature à un seul argument ; il a été réaligné pour
vérifier la tâche, les options de délégation et l'ordre de l'override.

Preuves :

- état initial : `npx vitest run tests/unit/swarm-handler.test.ts` → 1 échec,
  10 succès ;
- test réaligné : même commande → 11 succès ;
- mutation temporaire de `DEFAULT_CONCURRENCY` en `+ 1` → 1 échec, 10 succès ;
- restauration de la source → 11 succès.

Le fichier `src/commands/handlers/swarm-handler.ts` est restauré sans diff.

## Point 2 — écriture mémoire

À instruire : identifier le test de `tests/unit` qui écrit dans le dépôt réel,
puis isoler son chemin de mémoire sous `_qa/swarmfix1/home` ou le mocker.
