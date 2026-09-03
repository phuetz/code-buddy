# RAPPORT GK1 — Cowork installé et utilisé par un inconnu sous Linux

Date d'ouverture : 2026-09-03  
Agent : Grok 4.6  
Clone : `/home/patrice/DEV/cb-never-cowork-2026-09-02`  
Branche : `fix/gk1-cowork-inconnu-2026-09-03`  
Base au démarrage : `3fcf5a97d` (`docs(voice): consigner les preuves DARK3`)

Ce rapport est créé **avant** la lecture des cinq documents autorisés et avant toute inspection du code Cowork.

## Contraintes

- Rester dans ce clone. Original `~/code-buddy` interdit.
- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Aucune API payante. LLM local Ollama `qwen3:4b-instruct` / `qwen3.8:27b` sur `127.0.0.1:11434` autorisé, ou aucun.
- Aucun service systemd. Ne pas toucher ComfyUI (8188/8189) ni les services déjà à l'écoute.
- Aucune écriture hors clone ni dans `~/.codebuddy`. HOME temporaire dans le clone si un profil est nécessaire.
- Jamais `DISPLAY=:10`. Ports libres seulement.
- Typecheck + lint + tests ciblés verts. Un commit conventionnel par lot / écart.
- Posture : inconnu qui n'a que `README.md`, `docs/getting-started.md`, `cowork/README.md`, `cowork/DEV-LINUX.md`, `cowork/ARCHITECTURE.md`.

## Journal (fil de l'eau)

### 0. Ouverture (avant inspection)

- `git status -sb` : branche `fix/gk1-cowork-inconnu-2026-09-03`, arbre propre.
- `git log -1` : `3fcf5a97d docs(voice): consigner les preuves DARK3`.
- Présence des fichiers nommés par la mission (contrôle d'existence seulement) :
  - `README.md` : présent
  - `docs/getting-started.md` : présent
  - `cowork/README.md` : **absent** (`cowork/readme.md` existe en minuscules — écart potentiel, non tranché tant que la doc n'est pas lue)
  - `cowork/DEV-LINUX.md` : présent
  - `cowork/ARCHITECTURE.md` : présent
- `node_modules` racine : absent
- `cowork/node_modules` : absent
- HOME hôte : `/home/patrice` (ne pas y écrire ; profil GK1 = `HOME` sous le clone)
- Ports déjà à l'écoute (ne pas les prendre, ne pas y toucher) : `127.0.0.1:8188` ComfyUI, `0.0.0.0:3000` node, `0.0.0.0:3001` MainThread, `*:11434` Ollama.

## Parcours exigé

1. Installation (copie propre, sans `node_modules`)
2. Build (`npx vite build` selon DEV-LINUX)
3. Lancement Electron headless/xvfb si disponible, sinon Playwright `npm run test:e2e`
4. Premier démarrage (assistant, fournisseur Ollama local)
5. Premier chat
6. Un fichier créé par l'agent dans un dossier de travail
7. Bibliothèque de médias
8. Redémarrage : l'historique est là

Chaque écart doc/réalité = test rouge → correctif minimal → vert, un commit par écart. Les écarts de doc se corrigent dans la doc.

## Tableau final (à compléter)

| Étape | Durée | Écart | Correctif | Commit |
|---|---|---|---|---|
| *(en cours)* | | | | |

## Ce qui empêche un inconnu d'y arriver seul

*(à rédiger en fin de parcours)*

## Vérifications

*(commandes exactes et sorties collées au fil de l'eau)*
