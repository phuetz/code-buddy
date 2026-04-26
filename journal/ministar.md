# Journal — MINISTAR (G7 PT, Windows)

Écritures depuis la machine `MINISTAR`. Voir `README.md` pour la convention.

---

## 2026-04-26 — Convention "fichier par source" mise en place

Ouverture de ce fichier suite à un conflit de merge sur `journal.md` plus
tôt dans la journée. Une autre session Claude (probablement depuis cette
même machine en parallèle) avait poussé 3 commits sur `etat_projets.md` +
`journal.md` pendant que je préparais mes propres modifications. Résolution
manuelle propre, mais le scénario va se répéter sans changement de structure.

Patrice a validé la convention :

- `../journal.md` devient l'index consolidé **figé** jusqu'au 26 avril 2026.
- À partir d'aujourd'hui, chaque IA écrit dans `journal/<hostname>.md` —
  zéro zone partagée écrite en parallèle, donc zéro conflit physique.
- Détails dans `README.md` de ce dossier.
- Section ajoutée à `../COLAB.md` (la spec canonique).
- `../BRIEFING_NOUVEAU_CLAUDE.md` mis à jour pour briefer toute IA qui
  démarre.

Mapping initial : `MINISTAR` → `ministar.md`, `DARKSTAR` → `darkstar.md`.
À enrichir au fil des nouvelles machines.

Reste comme limite connue (déjà notée dans COLAB.md) : `etat_projets.md`
peut encore subir des conflits si deux IA modifient la même section. Règle
simple en attendant : `git pull --rebase` avant édition + préférer ajouter
une nouvelle section plutôt que toucher une existante.

## 2026-04-26 — [~] Code Buddy Vague 1 / Task #5 démarrée

**Claim** : je prends Task #5 (fusion async iterator unique) sur
`D:\CascadeProjects\grok-cli`. Plan : `~/.claude/plans/vague1-task5-design-decisions.md`
(6 KB, 25 avril). Pendant ce temps, Patrice merge `feat/semantic-search`
sur master côté gitnexus-rs.

**Étapes** (8 du plan, dans l'ordre) :
1. Étendre le sentinel parity pour couvrir multi-round + injection round-suivant
2. Étendre `injectInitialContext` pour inclure docs + todo (décision #1)
3. Extraire `runJitContextDiscovery` (décision #2)
4. Définir le type `ExecutorEvent` + stub `runTurnLoop`
5. Migrer la logique de `processUserMessageStream` → `runTurnLoop`
6. Réécrire `processUserMessageStream` en thin wrapper
7. Réécrire `processUserMessage` en collecteur sync des events
8. Tests verts → commit + update CLAUDE.md

**Filet** : 68 tests verts à chaque étape, sinon stop.
Si une autre IA voit ce claim : ne pas toucher `agent-executor.ts` ni
les modules dans `src/agent/execution/`.
