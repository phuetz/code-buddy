# RAPPORT-GK17 — La flotte multi-IA en vrai : deux pairs sur la même machine

Mission : se servir de la fonctionnalité phare de Code Buddy 2 (flotte multi-IA) **en vrai** — deux `buddy server` sur la même machine, Ollama local, HOME temporaire dans le clone.

- Clone : `/home/patrice/DEV/cb-repar-companion-2026-09-02`
- Branche : `fix/gk17-fleet-reel-2026-09-03`
- Date de démarrage : 2026-09-03 (Europe/Paris)
- Agent : Grok 4.6
- Rapport créé **avant** toute inspection du code source (protocole mission).

## Garde-fous (rappel)

- Aucun push, aucun `git prune` / `git reset --hard` / `rm -rf` / `git add -A` / `git commit -a`.
- Aucune API payante. LLM local Ollama uniquement.
- Aucun service systemd. Ne pas toucher ComfyUI 8188/8189.
- Aucune écriture hors du clone ni dans `~/.codebuddy` (HOME temporaire dans le clone).
- Dépôt original `~/code-buddy` interdit.
- Ports libres seulement — **jamais** 3000 / 3001 / 3055 / 8129.
- Tout arrêté à la fin (preuve `ss -ltn`).
- Un commit conventionnel par défaut corrigé (test rouge → correctif → vert).

## Journal

### 2026-09-03 — création du rapport (avant inspection)

Commandes :

```
date -Iseconds; hostname; git rev-parse HEAD; git status -sb; git log -5 --oneline; git diff --stat HEAD
ss -ltn | grep -E ':(3000|3001|3055|8129|8188|8189|11434)\b'
```

Sortie collée :

```
2026-09-03T11:55:26+02:00
Ministar
8a2b55e0d66dcce88fa577d12fdab01f539986c5
## fix/gk17-fleet-reel-2026-09-03
8a2b55e0d Merge branch 'fix/gk1-cowork-inconnu-2026-09-03' of /home/patrice/DEV/cb-never-cowork-2026-09-02 into codex/audit-systeme-nerveux-2026-09-01
ecfa81e40 docs(gk1): clôturer le rapport du parcours Cowork inconnu Linux
5aaa35736 Merge GK6 (buddy-memory Phase 4 : index HNSW + inversé, bascule rust par défaut mesurée) into codex/audit-systeme-nerveux-2026-09-01
13f878cec Merge branch 'feat/gk5-pocket-tts-rust-2026-09-03' of /home/patrice/DEV/cb-never-env-2026-09-02 into codex/audit-systeme-nerveux-2026-09-01
e7323711c docs(gk6): documenter Phase 4 et la bascule
---
(working tree clean)
---
LISTEN 127.0.0.1:3055
LISTEN 127.0.0.1:8188   (ComfyUI — ne pas toucher)
LISTEN 127.0.0.1:8129
LISTEN 0.0.0.0:3000
LISTEN 0.0.0.0:3001
LISTEN 203.0.113.10:8188 (ComfyUI — ne pas toucher)
LISTEN *:11434          (Ollama — autorisé, lecture seule)
```

Chantier réservé dans `docs/FABLE5-CODEX-COORDINATION.md`. Aucun fichier source lu encore. HOST=`Ministar`.

Ports **interdits** pour cette mission : 3000, 3001, 3055, 8129, 8188, 8189.

## Parcours prévu (non encore exécuté)

1. Démarrer deux `buddy server` A et B, ports distincts, `CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT` sur un dossier jouet de chacun, HOME temporaire dans le clone.
2. Depuis A : `/fleet describe`.
3. `peer.chat` vers B (réponse réelle Ollama).
4. `peer.chat-session.start|continue|end|list` — la liste ne fuit aucun contenu.
5. `peer.tool.invoke` `view_file`/`search` sur le workspace de B, REFUS hors workspace.
6. `/fleet route` sur un prompt avec IBAN factice (lint de vie privée).
7. `CODEBUDDY_FLEET_MAX_CONCURRENCY=1` et deux appels simultanés (saturation visible ?).
8. `peer.dispatch` + `dispatchStatus`.
9. Arrêt de B pendant une session (message d'erreur honnête ?).
10. Arrêt de A et B. Preuve `ss -ltn`.

Chaque défaut : test rouge → correctif → vert, un commit.

## Tableau final (scénario → attendu → obtenu → correctif)

| # | Scénario | Attendu | Obtenu | Correctif |
|---|---|---|---|---|
| 1 | `/fleet describe` depuis A | Décrit le pair B | — | — |
| 2 | `peer.chat` A→B | Réponse réelle Ollama | — | — |
| 3 | `peer.chat-session.start/continue/end` | Session multi-tour | — | — |
| 4 | `peer.chat-session.list` | Métadonnées seulement, aucun contenu | — | — |
| 5 | `peer.tool.invoke` `view_file`/`search` in-workspace | Lecture OK | — | — |
| 6 | `peer.tool.invoke` hors workspace | REFUS fail-closed | — | — |
| 7 | `/fleet route` + IBAN factice | Lint vie privée bloque | — | — |
| 8 | `CODEBUDDY_FLEET_MAX_CONCURRENCY=1` + 2 appels | Saturation visible | — | — |
| 9 | `peer.dispatch` + `dispatchStatus` | Dispatch + statut | — | — |
| 10 | Arrêt de B pendant une session | Erreur honnête | — | — |
| 11 | Arrêt final | Ports GK17 absents de `ss -ltn` | — | — |

## Bilan (à clore en ≤ 10 lignes)

*(vide — parcours pas encore lancé)*
