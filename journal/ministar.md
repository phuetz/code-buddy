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
