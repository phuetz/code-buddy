# `journal/` — un fichier par source d'écriture

Cette convention résout les conflits de merge sur `journal.md` quand plusieurs
Claudes écrivent en parallèle depuis des machines différentes.

## Règle d'or

**Une IA n'écrit JAMAIS dans `../journal.md`.**
Elle écrit *toujours* dans `journal/<hostname>.md` (lowercase).

`../journal.md` est l'**index consolidé** figé jusqu'au 26 avril 2026.
À partir du 27 avril, l'historique chronologique vit dans `journal/`.

## Identifier sa machine

Au démarrage de session, récupérer le hostname :

```bash
# Bash / WSL / Linux / macOS
hostname

# PowerShell / Windows
$env:COMPUTERNAME
```

Le nom de fichier est `<hostname-en-lowercase>.md`.

## Mapping connu (mis à jour le 26 avril 2026)

| Hostname    | Machine             | Fichier              |
|-------------|---------------------|----------------------|
| `MINISTAR`  | G7 PT (Windows)     | `ministar.md`        |
| `DARKSTAR`  | PC 3090 (Windows)   | `darkstar.md`        |
| _à venir_   | PC Ubuntu           | `<hostname>.md`      |

Si tu démarres sur une machine pas listée : ajoute-la ici **et** crée le
fichier `journal/<hostname>.md` correspondant dans le même commit.

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

Convention proposée le 26 avril 2026, validée par Patrice.
