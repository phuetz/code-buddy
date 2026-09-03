# RAPPORT-GK14 — `buddy science` et `buddy research --deep --ckg` en vrai

Mission : se servir des applis EN VRAI. Ce qu’un utilisateur obtient, ce qui casse, réparé.

- Clone : `/home/patrice/DEV/cb-repar-cb2-2026-09-02`
- Branche : `fix/gk14-science-reel-2026-09-03`
- Date de démarrage : 2026-09-03 (Europe/Paris)
- Agent : Grok 4.6
- Rapport créé **avant** toute inspection du code source science/research/CKG (protocole mission).

## Garde-fous (rappel)

- Aucun push, aucun `git prune` / `git reset --hard` / `rm -rf` / `git add -A` / `git commit -a`.
- Aucune API payante. LLM local Ollama et DuckDuckGo/SearXNG ($0) autorisés.
- Aucun service systemd. Ne pas toucher ComfyUI 8188/8189.
- Aucune écriture hors du clone ni dans `~/.codebuddy` (HOME temporaire dans le clone).
- Dépôt original `~/code-buddy` interdit.
- Aucune donnée personnelle.
- Un commit conventionnel par lot. Typecheck + lint + tests ciblés verts.
- Chaque défaut : test rouge → correctif → vert, un commit. Rejouer après correction.

## Journal

### 2026-09-03 — création du rapport (avant inspection)

Commandes :

```
git status -sb && git log -3 --oneline && git rev-parse HEAD && git status --porcelain | wc -l
```

Sortie collée :

```
## fix/gk14-science-reel-2026-09-03
13f878cec Merge branch 'feat/gk5-pocket-tts-rust-2026-09-03' of /home/patrice/DEV/cb-never-env-2026-09-02 into codex/audit-systeme-nerveux-2026-09-01
53a02dd1a Merge branch 'fix/gk2-research-deep-2026-09-03' of /home/patrice/DEV/cb-never-tools-2026-09-02 into codex/audit-systeme-nerveux-2026-09-01
2a4e7c39f docs(gk5): coller le SHA du lot documentaire
---
13f878cec7da22d59416b16b867fc409a730e104
---
0
```

Arbre propre. HEAD de départ `13f878cec`. Aucun fichier source science/research/CKG lu encore.

Chantier à réserver dans `docs/FABLE5-CODEX-COORDINATION.md`. HOME temporaire prévu : `_gk14/home` dans le clone.

## 1. `buddy science` — à remplir après exécution réelle

Question prévue (modeste, vérifiable) : « l'hystérésis d'un VAD réduit-elle les fausses coupes ? »

| Phase | Annoncée | Exécutée | Sortie collée | Honnêteté |
|---|---|---|---|---|
| hypothèse | — | — | — | — |
| expérience exécutable | — | — | — | — |
| résultat | — | — | — | — |
| rapport | — | — | — | — |

## 2. `buddy research --deep --ckg` puis `recall` / `stats` — à remplir

| Commande | Attendu | Obtenu | Notes |
|---|---|---|---|
| `buddy research "<sujet>" --deep --ckg` | sources réelles, ingestion CKG | — | — |
| `buddy research recall "<sujet>"` | sources rappelées | — | — |
| `buddy research stats` | compteurs cohérents | — | — |

## 3. Défauts (rouge → correctif → vert)

Aucun encore : l’exécution réelle n’a pas commencé.

## Tableau final commande → attendu → obtenu → correctif → commit

À remplir en fin de mission.

## Bilan (≤10 lignes)

À remplir en clôture.
