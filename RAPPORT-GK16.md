# RAPPORT-GK16 — `buddy backup create|verify|list|restore` en vrai

Mission : exercer la commande `buddy backup` pour de vrai, y compris les cas méchants, dans un HOME temporaire du clone.

- Clone autorisé : `/home/patrice/DEV/cb-repar-channels-2026-09-02` uniquement
- Branche : `fix/gk16-backup-reel-2026-09-03`
- HEAD au départ : `13f878cec` (`Merge branch 'feat/gk5-pocket-tts-rust-2026-09-03' …`)
- Date de démarrage : 2026-09-03 (Europe/Paris)
- Agent : Grok 4.6
- Rapport créé **avant** toute inspection du code backup (`src/commands/backup*.ts`, `src/backup/`, tests, doc utilisateur).

## Garde-fous (rappel)

- Aucun push, aucun `git prune` / `git reset --hard` / `rm -rf` / `git add -A` / `git commit -a`.
- Aucune API payante. Ollama local autorisé.
- Aucun service systemd. Ne pas toucher ComfyUI 8188/8189.
- Aucune écriture hors du clone ni dans `~/.codebuddy` (HOME temporaire dans le clone, peuplé de faux fichiers).
- Dépôt original `~/code-buddy` interdit.
- Aucune donnée personnelle. Aucun fichier réel de `~/.codebuddy`.
- Un commit conventionnel par lot. Typecheck + lint + tests ciblés verts.

## Journal

### 2026-09-03 — création du rapport (avant inspection)

Commandes :

```
git status -sb && git log -5 --oneline && git rev-parse HEAD
```

Sortie collée :

```
## fix/gk16-backup-reel-2026-09-03
---
13f878cec Merge branch 'feat/gk5-pocket-tts-rust-2026-09-03' of /home/patrice/DEV/cb-never-env-2026-09-02 into codex/audit-systeme-nerveux-2026-09-01
53a02dd1a Merge branch 'fix/gk2-research-deep-2026-09-03' of /home/patrice/DEV/cb-never-tools-2026-09-02 into codex/audit-systeme-nerveux-2026-09-01
2a4e7c39f docs(gk5): coller le SHA du lot documentaire
369ccde0a docs(gk5): consigner la faisabilité Pocket TTS Rust/ONNX
03bb492c3 feat(buddy-sense): ajouter Pocket TTS ONNX (feature pocket-tts)
---
13f878cec7da22d59416b16b867fc409a730e104
```

Arbre de travail propre au départ (aucun fichier modifié/non suivi). Chantier réservé dans `docs/FABLE5-CODEX-COORDINATION.md`. Aucun fichier source backup lu encore.

## Périmètre annoncé (à remplir après lecture)

Fichiers à lire ensuite (annoncés, pas encore ouverts) :

- `src/commands/backup*.ts`
- `src/backup/`
- `tests/backup/`
- documentation utilisateur relative à `buddy backup`

Cycle réel prévu, HOME temporaire du clone uniquement :

1. peupler un faux `~/.codebuddy` (config / mémoire / sessions)
2. `create` → `list` → `verify`
3. modifier des fichiers
4. `restore` et comparer sha256 avant/après

Cas méchants prévus :

- archive tronquée
- archive avec symlink absolu et `../`
- fichier de 0 octet
- disque « plein » simulé
- restauration dans un profil non vide (fusion ou refus explicite ?)
- archive d'une version antérieure du format

Chaque défaut : test rouge → correctif → vert, un commit.

## Tableau final (à compléter)

| Cas | Attendu utilisateur | Observé | Verdict | Correctif |
|-----|---------------------|---------|---------|-----------|
| *(vide jusqu'à exécution)* | | | | |

## Ce qu'un utilisateur peut croire à tort

*(à remplir après les exécutions)*

## Bilan (≤ 10 lignes)

*(à remplir en fin de mission)*
