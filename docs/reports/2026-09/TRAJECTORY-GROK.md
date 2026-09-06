# TRAJECTORY-GROK — C5 taxonomie d'effet des outils + C1 vue Trajectory unifiée

Date : 2026-09-06 (Europe/Paris)
Agent : Grok 4.6
Clone : `~/DEV/cb-heartwatch-2026-09-05`
Branche : `feat/trajectory-2026-09-06`
HEAD au départ : `35443b9ec` (`docs(audit): étude DeepSeek Harness vs Code Buddy`)
Original `~/code-buddy` : interdit (jamais ouvert, jamais écrit)
Rapport créé **avant toute inspection** (réservation à commiter).
HOME temporaire : `_qa/traj/home`. Aucune écriture dans le vrai `~/.codebuddy`.
Cahier des charges : `docs/audits/2026-09-06-deepseek-harness-etude.md` §4 C1 et C5.

## Mission

1. **C5 (S)** — classification par outil `effect: 'read' | 'reversible' | 'emission'` dans `src/tools/metadata.ts` (et le type). Renseigner les ~110 outils. Test qui échoue si un outil n'a pas de classe. Exposer dans `tool_search` / `buddy tools` s'ils listent les métadonnées.
2. **C1 (M)** — `buddy run trajectory <runId> [--json] [--since]` : vue unifiée d'un run à partir de ce qui EXISTE. Pure fonction `buildTrajectory(sources) → Trajectory`. Aucune nouvelle télémétrie. Donnée manquante → « non journalisé ». Lecture seule, toujours disponible.

## Garde-fous

- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Vitest : `HOME=~/DEV/cb-heartwatch-2026-09-05/_qa/traj/home` et `env -u FORCE_COLOR`.
- Jamais `/home/<user>` ni prénom dans les fichiers (écrire `~`).
- ComfyUI 8188/8189 non touché. Aucun service systemd.

## Journal

### 2026-09-06 — création du rapport (avant inspection)

HEAD `35443b9ec`. Branche `feat/trajectory-2026-09-06` déjà extraite. Inspection du code **après** ce fichier et la réservation.

### Inspection (après réservation)

_(à remplir)_

### C5 — taxonomie

_(tableau des outils + justification de chaque `emission` — à remplir)_

### C1 — vue Trajectory

_(sources lues, données « non journalisé », schéma JSON — à remplir)_

### Preuves

_(commandes + résultats — à remplir)_

## Bilan (10 lignes, pas de verdict)

_(à remplir en fin de mission)_
