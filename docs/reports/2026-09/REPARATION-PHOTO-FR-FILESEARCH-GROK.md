# REPARATION-PHOTO-FR-FILESEARCH-GROK — souvenir photo en français + `file_search` ancré sur le cwd

Date : 2026-09-06 (Europe/Paris)
Agent : Grok 4.6
Worktree : `~/DEV/cb-photo-fr-2026-09-06`
Branche : `fix/photo-memoire-fr-2026-09-06`
HEAD au départ : `631071f6f` (`Merge branch 'fix/failover-handoff-2026-09-06' into codex/audit-systeme-nerveux-2026-09-01`)
Original `~/code-buddy` : interdit (jamais ouvert, jamais écrit)
Rapport créé **avant toute inspection**.
HOME temporaire : `_qa/pf/home`. Aucune écriture dans le vrai `~/.codebuddy`.
Ollama : `http://127.0.0.1:11435`. Modèles autorisés : `qwen3:4b-instruct` et `moondream` uniquement.

Source des réserves : `docs/reports/2026-09/PHOTOS-PARTAGEES-OPUS.md` § 10 (description moondream anglaise dans `photos:recent`).

## Mission

Deux réserves ouvertes :

1. **Souvenir en français.** Quand la description vient du VLM local (anglais), la ligne mémoire `photos:recent` et le sidecar `descriptionLisa` passent par un court résumé FRANÇAIS produit par le modèle compagnon courant (≤ 25 mots, une phrase, à la première personne de Lisa : « tu m'as montré … »), avec repli déterministe (traduction des 30 mots de couleur/forme/lieu les plus fréquents) si le modèle est indisponible ; jamais d'anglais brut dans `<recent_photos>`.
2. **`file_search` en `-p`.** Reproduire d'abord (dossier temporaire à 3 fichiers, `CODEBUDDY_PROVIDER=ollama … node dist/index.js -p "liste les fichiers du dossier courant"` après `npm run build`) — l'outil cherche depuis la racine du dépôt ou du cwd ? Corriger pour que la racine par défaut soit `process.cwd()` (le dossier de lancement), sans casser l'usage interactif dans un dépôt (test des deux cas).

## Garde-fous

- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Vitest : `HOME=~/DEV/cb-photo-fr-2026-09-06/_qa/pf/home` et `env -u FORCE_COLOR`.
- Ports ≥ 5200. ComfyUI 8188/8189 non touché.
- Jamais `/home/<user>` ni prénom dans les fichiers suivis (écrire `~`).
- Un commit par point. `git add` fichier par fichier.
- Pas de verdict dans ce rapport (le pilote le fera).

## Journal

### 2026-09-06 — création du rapport (avant inspection)

HEAD `631071f6f`. Branche déjà extraite. Réservation à commiter.

### Inspection

(à compléter)

### Implémentation (un commit par point)

| Point | Commit | Contenu |
|---|---|---|
| Réservation | | Rapport + ligne Fable 5 |
| 1. Souvenir FR | | Résumé français + repli déterministe |
| 2. `file_search` cwd | | Racine par défaut = `process.cwd()` |

### Preuves

(à coller)

### Essai réel headless (point 2)

(à coller)

### Bilan

(à coller)
