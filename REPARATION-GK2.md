# Réparation GK2 — `buddy research --deep` renvoie zéro source

- Début : 2026-09-03 (Europe/Paris)
- Clone autorisé : `/home/patrice/DEV/cb-never-tools-2026-09-02` uniquement
- Branche attendue : `fix/gk2-research-deep-2026-09-03`
- HEAD au départ : `3fcf5a97d` (`docs(voice): consigner les preuves DARK3`)
- Contraintes : aucun push ; aucune API payante (LLM local Ollama `qwen3:4b-instruct` / `qwen3.8:27b` sur `127.0.0.1:11434` autorisé, ou aucun) ; aucun service systemd ; aucune écriture hors du clone ni dans `~/.codebuddy` (HOME temporaire dans le clone si un test a besoin d’un profil) ; dépôt original `~/code-buddy` interdit ; aucune donnée personnelle ; jamais `DISPLAY=:10` ; ports libres seulement.

Fait mesuré (RECH3, 02/09) : « les deux `buddy research --deep` ont bien été lancés mais ont retourné zéro source ».

## Journal initial

Ce rapport a été créé **avant toute inspection** du code de recherche, conformément à la mission.

### Garde-fous respectés

- Pas de `git push`, `git prune`, `git reset --hard`, `rm -rf`.
- Pas de `git add -A` ni `git commit -a`.
- ComfyUI 8188/8189 non touché.
- Services systemd non touchés.

### Fichiers lus (à compléter au fil de l’eau)

- `docs/FABLE5-CODEX-COORDINATION.md` (protocole, réservation GK2)
- (inspection code : pas encore commencée au moment de la création de ce fichier)

### Plan de preuve

1. Reproduire en réel (DuckDuckGo et/ou SearXNG si joignable, sinon serveur HTTP factice local). Journaliser à chaque étage combien de résultats entrent/sortent. Trouver où ils disparaissent.
2. Test ROUGE reproduisant la perte (fournisseur factice qui renvoie 5 résultats → rapport à 0 source) ; correctif ; VERT ; un `--deep` réel avec ≥ 5 sources citées collé ici (texte tronqué, sans donnée personnelle).
3. Le mode ne doit plus JAMAIS annoncer un rapport « réussi » avec zéro source : échec explicite avec la raison par étage (test).

### Commandes exécutées

```text
git status -sb
git branch --show-current
git log -5 --oneline
```

Résultat : branche `fix/gk2-research-deep-2026-09-03`, HEAD `3fcf5a97d`.

## Reproduction (à remplir)

(en attente)

## Cause racine (à remplir)

(en attente)

## Correctifs (à remplir)

(en attente)

## Preuves rouge → vert (à remplir)

(en attente)

## `--deep` réel ≥ 5 sources (à remplir)

(en attente)

## Bilan

(en attente)
