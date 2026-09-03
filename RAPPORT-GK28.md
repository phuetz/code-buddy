# RAPPORT-GK28 — `buddy cost`, `buddy run list|show|tail|replay`, `buddy changelog`, `buddy explain`, `buddy import` en vrai

Date : 2026-09-03 (Europe/Paris)
Agent : Grok 4.6
Clone : `/home/patrice/DEV/cb-repar-catalogue-2026-09-02`
Branche : `fix/gk28-analytics-reel-2026-09-03`
HEAD au départ : `5e7639b42` (`Merge GK22 (skills en vrai : import, quarantaine, exchange signé, curation) into codex/audit-systeme-nerveux-2026-09-01`)
Original `~/code-buddy` : interdit (jamais ouvert, jamais écrit)
Rapport créé **avant toute inspection** de `src/commands/`, `src/analytics/`, `src/observability/`, `src/git/changelog.ts` et tests associés.

## Mission

Éprouver **pour de vrai** les commandes analytics / observabilité :

1. quelques tours d'agent headless avec Ollama sur un dépôt jouet (coût 0 attendu) ;
2. `buddy cost` — tableau cohérent : 0 $, tokens réels, par modèle ;
3. `buddy run list|show|tail|replay` — le replay rejoue vraiment, le tail suit un run en cours ;
4. `buddy changelog` — dépôt avec tags factices : notes générées, sans inventer ;
5. `buddy explain` — explication fondée sur les fichiers du jouet, 3 affirmations vérifiées ;
6. `buddy import` — config MCP/Claude Code factice (`.mcp.json`, `settings.json`) fusionnée et validée.

Chaque défaut (coût faux, run « rejoué » sans effet, changelog inventé, import silencieux qui écrase, doc fausse) : test rouge → correctif → vert, un commit.

Tableau final : commande → attendu → obtenu → correctif → commit.

## Garde-fous

- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Aucune API payante. Ollama local uniquement. `CODEBUDDY_PROVIDER=ollama` forcé (un login ChatGPT ne doit pas prendre le dessus).
- Buddy invoqué depuis le clone : `node node_modules/tsx/dist/cli.mjs src/index.ts` (le lanceur `~/.local/bin/buddy` pointe vers `~/code-buddy`, interdit).
- HOME temporaire : `_qa/gk28/home` dans le clone. Aucune écriture dans le vrai `~/.codebuddy`.
- Aucun service systemd. ComfyUI 8188/8189 non touché.
- Dépôt jouet et fixtures : `_qa/gk28/` uniquement.

## Journal

### 2026-09-03 — création du rapport (avant inspection)

HEAD `5e7639b42`. Arbre propre. Réservation du chantier dans `docs/FABLE5-CODEX-COORDINATION.md`.

### Inspection

*(à remplir après réservation)*

### Parcours réel

*(à remplir)*

### Défauts, rouge → vert

*(à remplir)*

## Tableau final

| Commande | Attendu | Obtenu | Correctif | Commit |
|---|---|---|---|---|
| `buddy cost` | | | | |
| `buddy run list` | | | | |
| `buddy run show` | | | | |
| `buddy run tail` | | | | |
| `buddy run replay` | | | | |
| `buddy changelog` | | | | |
| `buddy explain` | | | | |
| `buddy import` | | | | |

## Bilan (≤ 10 lignes)

*(à remplir en fin de mission)*
