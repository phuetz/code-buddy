# `journal/` — un fichier par source d'écriture

Cette convention résout les conflits de merge sur `journal.md` quand plusieurs
Claudes écrivent en parallèle, soit depuis des machines différentes, soit
depuis des working directories différents sur la même machine (cas réel
observé le 26 avril : deux sessions Claude Code parallèles sur MINISTAR,
une dans grok-cli et l'autre dans gitnexus-rs).

## Règle d'or

**Une IA n'écrit JAMAIS dans `../journal.md`.**
Elle écrit *toujours* dans `journal/<hostname>-<repo>.md` (lowercase).

`../journal.md` est l'**index consolidé** figé jusqu'au 26 avril 2026.
À partir du 27 avril, l'historique chronologique vit dans `journal/`.

## Identifier son fichier

Au démarrage de session, dériver le nom de fichier :

```bash
# Bash / WSL / Linux / macOS
echo "$(hostname | tr '[:upper:]' '[:lower:]')-$(basename "$PWD").md"

# PowerShell / Windows
"{0}-{1}.md" -f $env:COMPUTERNAME.ToLower(), (Split-Path -Leaf $PWD)
```

Pattern : `<hostname-lowercase>-<basename-cwd-lowercase>.md`.

## Mapping connu (mis à jour le 26 avril 2026)

| Hostname    | Machine                     |
|-------------|-----------------------------|
| `MINISTAR`  | G7 PT (Windows, dev principal) |
| `DARKSTAR`  | PC 3090 (Windows, training)    |
| `Ministar` (Linux) | PC Ubuntu (futur robot runtime, Minisforum Ryzen AI 9 HX 470, hostname homonyme du G7 PT) |

**Note** : G7 PT et MINISTAR (Windows) sont **la même machine**. Le PC
Ubuntu réutilise le hostname `Ministar` (casse mixte) — pour le distinguer
en journal, suffixer `-ubuntu` (ex : `ministar-ubuntu-DEV.md`).

### Fichiers actuels

| Fichier                            | Source                                                  |
|------------------------------------|---------------------------------------------------------|
| `ministar-grok-cli.md`             | session sur `D:\CascadeProjects\grok-cli`               |
| `ministar-gitnexus-rs.md`          | session sur `C:\Users\patri\CascadeProjects\gitnexus-rs` (rôle coordinateur depuis 28/04/2026) |
| `ministar-patrice-huetz-site-next.md` | session sur le site personnel `patricehuetz.fr`     |
| `ministar-ubuntu-DEV.md`           | session sur PC Ubuntu (`/home/patrice/DEV`), futur runtime robot |
| `darkstar-DEV.md`                  | session sur DARKSTAR Windows (PC 3090) — bootstrap initial 2026-05-01 |
| `darkstar-world-model.md`          | session sur DARKSTAR (`D:\CascadeProjects\world-model`), entraînement world-model JEPA V3 |
| `darkstar-grok-cli.md`             | session sur DARKSTAR (`D:\DEV\grok-cli`), spoke A2A code-buddy pour le fleet |
| _à créer au besoin_                | autres machines/repos                                    |

Si tu démarres sur un repo pas listé : ajoute-le ici **et** crée le
fichier correspondant dans le même commit.

## Format d'écriture

Append-only. Chaque entrée datée. Format suggéré (cohérent avec
`../journal.md` historique) :

```markdown
## YYYY-MM-DD — titre court

Corps de l'entrée. Faits, décisions, commits, leçons. Pas de mise en forme
fancy nécessaire.

(Optionnel) bloc "Sur notre application" / "Pensée du jour" en fin
d'entrée si tu veux marquer un moment.
```

**Ne JAMAIS modifier ou supprimer les entrées des autres fichiers** — chaque
fichier appartient à sa machine. Si tu vois un truc à corriger ailleurs,
ajoute une note dans ton propre fichier ou parle-en à Patrice.

## Lecture

Pour avoir la chronologie complète :

```bash
# Vue brute, fichier par fichier
ls journal/*.md

# Vue chronologique consolidée (futur — script à écrire)
# python tools/consolidate_journal.py > journal-consolidated.md
```

À terme, un script de consolidation pourra fusionner tout le journal/ dans
un nouveau `journal-consolidated.md` trié par date. Pas urgent — la lecture
fichier-par-fichier suffit pour l'instant.

## Pourquoi cette convention

Voir `../COLAB.md` section "Écriture concurrente". TL;DR : git ne sait pas
appender sémantiquement, donc deux écritures en fin de fichier = conflit
inévitable. Un fichier par source garantit zéro conflit physique sur les
zones d'écriture, au prix d'une lecture fragmentée (récupérable via
consolidation post-hoc).

Convention initialement proposée le 26 avril 2026 (juste hostname). Évoluée
le même jour pour ajouter `-<repo>` après détection que deux sessions Claude
peuvent tourner sur la même machine en parallèle dans des working directories
différents.
