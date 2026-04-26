# COLAB.md — Convention multi-IA

> **Spec canonique** de la convention `COLAB.md` que Patrice utilise pour faire
> bosser plusieurs IA (Claude, Codex, Gemini) sur un même projet.
>
> Ce fichier-ci est la **spec** : il définit la convention.
> Chaque projet de Patrice contient son propre `COLAB.md` **vivant** (avec son
> propre journal de bord, ses tâches, son audit). Les deux ne se confondent pas.

---

## Origine

Idée de **Lisa**, avril 2026. Le constat : sans mémoire externe partagée, les IA
qui bossent sur un même projet en parallèle ou en série se marchent dessus,
oublient les décisions précédentes, et reproduisent les mêmes régressions.
`COLAB.md` est une mémoire externe **git-native**, lisible par toutes les IA,
qui survit aux resets de contexte.

---

## Quand utiliser COLAB.md

Sur tout projet de code où plus d'une IA va contribuer (séquentiellement ou en
parallèle). Pas nécessaire pour un repo single-IA ou un repo personnel
(notes, dossier MDPH, livre).

Projets de Patrice qui l'utilisent (à jour 2026-04-26) :
- `workflow/` (v6.0.0, le plus mature — base de cette spec)
- `MonArtisant/` (v2.0)
- À ajouter à la création de tout nouveau projet de code multi-IA.

---

## Règles cardinales

```
RÈGLE 1 — Max 10 fichiers modifiés par itération
RÈGLE 2 — Chaque tâche testée avant de passer à la suivante
RÈGLE 3 — Aucun script automatique de correction sans validation préalable
          (10+ régressions historiques sur workflow ont motivé cette règle)
RÈGLE 4 — Boucle de rétroaction obligatoire après chaque modif
RÈGLE 5 — Documenter chaque changement dans le Journal de Bord
```

### Boucle de rétroaction (règle 4 — non négociable)

Après CHAQUE itération, dans cet ordre :

```bash
npm run typecheck    # ou équivalent : tsc --noEmit, mypy, cargo check
npm run lint         # eslint, ruff, clippy
npm run test         # filtré sur les fichiers modifiés
npm run build        # build complet de vérif
```

**Si une étape échoue : corriger AVANT de passer à la tâche suivante.** Pas de
"je nettoierai après". Le code casse vite et le journal devient menteur.

---

## Protocole de communication entre IA

Chaque IA qui touche au projet DOIT :

1. **Avant de commencer** : lire `COLAB.md` entièrement (ce fichier + le COLAB.md du projet)
2. **Prendre une tâche** : mettre son statut à `[~]` avec son identifiant + date
3. **Après chaque itération** : mettre à jour le Journal de Bord
4. **En cas de blocage** : documenter dans la section Blocages, ne pas deviner
5. **Tâche terminée** : mettre `[x]` avec preuve (commit hash, output de test, etc.)

### Convention de statut

| Symbole | Signification |
|---------|---------------|
| `[ ]`   | À faire |
| `[~]`   | En cours (indiquer IA + date) |
| `[x]`   | Fait et validé |
| `[!]`   | Bloqué (voir section Blocages) |
| `[-]`   | Abandonné (justification requise) |

### Gestion des conflits

Deux IA sur des fichiers qui se chevauchent :
1. Le premier à avoir mis `[~]` a la priorité.
2. Le second choisit une autre tâche ou attend.
3. En cas de doute : documenter dans Blocages et attendre arbitrage de Patrice.

---

## Structure recommandée d'un COLAB.md vivant

```markdown
# COLAB.md — <nom-projet>

> Version: x.y.z
> Date: YYYY-MM-DD
> Statut: <en cours | bloqué | livré>

## 1. Règles de collaboration
   (référencer cette spec, surcharger si besoin spécifique au projet)

## 2. Audit global
   (métriques clés : LOC, erreurs TS, couverture tests, etc.)

## 3. Architecture cible
   (où on va, quelle est la cible)

## 4. Phases de travail
   (backlog avec statut [ ]/[~]/[x]/[!]/[-])

## 5. Journal de bord
   (append-only, daté, signé par l'IA — ce qui a été fait, ce qui a été observé)

## 6. Blocages
   (problèmes ouverts qui demandent arbitrage humain)

## 7. Protocole de validation
   (commandes spécifiques au projet pour la boucle de rétroaction)
```

---

## Ce que COLAB.md NE remplace PAS

- **Le peer review** — un journal dit "ce qui a été fait", pas "ce qui est correct".
  Sur un changement sensible (crypto, migration, sécu) : faire passer un agent
  code-reviewer **indépendant** avant merge. Cf. session NexusFile 2026-04-24
  (le reviewer a chopé une fuite de private key que le journal ne mentionnait pas).
- **Git history** — les commits restent l'autorité sur le code. Le COLAB.md
  documente les **décisions** et le **contexte**, pas les diffs.
- **CLAUDE.md** — `CLAUDE.md` reste la doc projet (build, conventions, archi).
  `COLAB.md` est le plan de coordination + journal.

---

## Écriture concurrente — convention fichier par source

Quand plusieurs IA écrivent en parallèle dans le même journal depuis des
machines différentes, on tombe systématiquement sur des conflits git :
git ne sait pas appender sémantiquement, deux écritures en fin de fichier
= deux modifications du dernier hunk = conflit.

**La convention** (validée 2026-04-26, après un conflit observé sur
`claude-et-patrice/journal.md`) :

- **Une IA n'écrit jamais dans un journal monolithique partagé.**
- Elle écrit toujours dans `journal/<hostname>.md` (lowercase) où
  `<hostname>` vient de `hostname` (bash) ou `$env:COMPUTERNAME` (PS).
- Le journal monolithique (`journal.md` à la racine) devient un **index
  consolidé** figé ou mis à jour par un seul agent à la fois.
- Lecture chronologique : fichier par fichier, ou via un script de
  consolidation post-hoc.

Voir `claude-et-patrice/journal/README.md` pour le mapping machines→fichiers
et le format d'écriture détaillé.

Pour les fichiers d'**état** (pas de journal — `etat_projets.md`,
`depots_associes.md`, etc.) : `git pull --rebase` avant édition + préférer
ajouter une nouvelle section plutôt que toucher une existante. Les conflits
y sont rares, cette discipline simple suffit.

---

## Limites connues (à ne pas oublier)

- **La convention "fichier par source" résout le conflit de journal** mais
  pas le claim/release atomique sur le code (qui bosse sur quel fichier
  *en ce moment* reste implicite dans le journal). Pour de la concurrence
  réelle sur le code, il manque encore une brique (probablement à backer
  par GitNexus).
- **Repose sur la discipline** : pas de forcing automatique. Une IA qui oublie
  de logger rend l'asynchronie invisible.
- **Bit-rot à l'échelle** : à 200+ entrées par fichier, parsing au démarrage
  devient lourd. Prévoir rotation/archivage (par trimestre, par exemple
  `journal/<hostname>-2026q2.md`).

---

## Mise en place sur un nouveau projet

1. Copier ce fichier comme template dans le nouveau projet.
2. Adapter les commandes de la boucle de rétroaction (TypeScript / Python / Rust / etc.).
3. Remplir l'audit global initial (métriques, problèmes critiques).
4. Ajouter une entrée dans `claude-et-patrice/etat_projets.md` "Projets WSL"
   (ou équivalent) pointant vers le projet.
5. Au premier briefing d'une IA sur ce projet, la pointer vers `COLAB.md` AVANT `CLAUDE.md`.
