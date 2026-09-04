# REPARATION-HOMEBACKUP1 — Sauvegarde du profil ~/.codebuddy

**Date:** 2026-09-04  
**Branche:** `feat/homebackup1-profil-2026-09-04`  
**Commit de départ:** `0f5d5542c`  
**Statut:** EN COURS  

## Mission
Implémenter `buddy backup create --profile` pour sauvegarder le profil `~/.codebuddy` avec une **liste blanche** stricte, en excluant systématiquement les secrets et les fichiers volumineux.

## Constat initial
- `buddy backup create` ne sauvegarde que le `.codebuddy/` du PROJET
- Le profil `~/.codebuddy` pèse **1,3 To** (images dans `personas/`, `runtimes/` 16 Go, `moshi/` 8 Go)
- Une **liste noire** est impossible (un `tar` a atteint 71 Go avant d'être tué)
- Ce matin: `user-settings.json` vidé et `identity-links.json` pollué par des tests, **sans aucune copie de secours**

## Objectifs (À FAIRE)
1. ✅ **Créer ce rapport** — DONE
2. ⏳ **Réserver dans FABLE5-CODEX-COORDINATION.md**
3. ⏳ **Implémenter `buddy backup create --profile`** avec:
   - `--scope home|project|both` pour choisir la portée
   - Liste blanche de motifs documentés (constante testée)
   - Plafond de taille: 5 Mo par fichier, 200 Mo global
   - Rapport de ce qui est SAUTÉ et pourquoi
   - Refus explicite des motifs secrets même s'ils sont demandés
4. ⏳ **Implémenter `buddy backup verify --profile`**
5. ⏳ **Implémenter `buddy backup restore --profile --confirm`**
6. ⏳ **Ajouter `--dry-run`** pour prévisualiser sans écrire
7. ⏳ **Créer les tests** avec un faux HOME peuplé
8. ⏳ **Prouver**: `npx vitest run tests/backup tests/commands/backup*`
9. ⏳ **Prouver**: `tsc` 0 erreur
10. ⏳ **Prouver**: `eslint` ciblé 0 erreur
11. ⏳ **Prouver**: `git diff --check` clean
12. ⏳ **Test réel en LECTURE SEULE** sur le vrai `~/.codebuddy`

## Liste blanche des fichiers à sauvegarder
```
settings.json
user-settings.json
personas/*.json (SANS les images)
memory.md
CODEBUDDY_MEMORY.md
reminders.json
snoozes.json
pending-acks.json
speech-hotwords.txt
mcp.json
skills/**/SKILL.md
self-improvement/store/
collective/ckg-ledger.jsonl
identity-links.json
vision.env
```

## Liste noire ABSOLUE (jamais sauvegardés)
```
*.env
*auth*
credentials*
*token*
*secret*
*.enc
```

## Limites
- **Par fichier:** 5 Mo (défaut, configurable)
- **Global:** 200 Mo (défaut, configurable)

## Sortie
- Archive JSON (comme aujourd'hui) ou tar.gz
- Dans `~/.codebuddy/backups/` par défaut
- `--output` pour changer le chemin

## bilateral
Dix lignes max à la fin avec les SHA.
