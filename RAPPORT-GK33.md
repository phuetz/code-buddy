# RAPPORT-GK33 — Les modes de recherche en vrai

Mission : se servir des applis EN VRAI. `buddy research --deep --iterations N`, `--storm --perspectives N`, `buddy flow`, PaperQA-lite. Ce qu’un utilisateur obtient, ce qui casse, réparé.

- Clone : `/home/patrice/DEV/cb-repar-slash-2026-09-02`
- Branche : `fix/gk33-recherche-modes-2026-09-03`
- Date de démarrage : 2026-09-03 (Europe/Paris)
- Agent : Grok 4.6
- Rapport créé **avant** toute inspection du code source research/flow/PaperQA (protocole mission).
- HEAD de départ : `4941ce857`
- Réservation : *(à coller après le commit de réservation)*

## Garde-fous (rappel)

- Aucun push, aucun `git prune` / `git reset --hard` / `rm -rf` / `git add -A` / `git commit -a`.
- Aucune API payante. LLM local Ollama ; recherche web DuckDuckGo/SearXNG ($0) ou faux serveur loopback si le réseau bloque.
- Aucun service systemd. ComfyUI 8188/8189 non touché.
- Aucune écriture hors du clone ni dans `~/.codebuddy` (HOME = `_qa/gk33/home` dans le clone).
- Dépôt original `~/code-buddy` interdit.
- Aucune donnée personnelle.
- Un commit conventionnel par lot. Typecheck + lint + tests ciblés verts.
- Chaque défaut : test rouge → correctif → vert, un commit. Rejouer après correction.
- `DISPLAY` unset.

## Journal

### 2026-09-03 — création du rapport (avant inspection)

```
## fix/gk33-recherche-modes-2026-09-03
4941ce857 Merge GK26 (porte de revue des diffs en vrai) into codex/audit-systeme-nerveux-2026-09-01
---
4941ce857e33e56e0c027c4e0f10fcd9ef3c6e8e
0 fichiers sales
```

Sujet prévu : hystérésis d’un VAD (vérifiable). Parcours prévu :

1. `buddy research --deep --iterations 2` — les tours de comblement ajoutent-ils des sources ou rejouent-ils les mêmes ?
2. `buddy research --storm --perspectives 3` — perspectives distinctes ou trois fois la même ?
3. Contrôle de 5 citations : chaque affirmation citée a-t-elle une source qui contient bien l’idée ?
4. `buddy flow "<objectif>"` — plan → exécution → synthèse réels.
5. PaperQA-lite sur 3 PDF locaux — extraits corrects, pas d’invention.

Chaque défaut (rapport « réussi » sans source, citation qui ne dit pas ce qu’on lui fait dire, perspectives dupliquées, flow qui saute une phase, sortie polluée) : test rouge → correctif → vert, un commit.

Tableau final « commande → attendu → obtenu → correctif → commit » : à remplir après les parcours.

## Environnement mesuré

*(à remplir après les probes, sans inspecter encore le source research)*
