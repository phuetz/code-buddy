# RAPPORT-GK27 — Le conseil de modèles en vrai (`buddy council`, `CODEBUDDY_COUNCIL_ROUTING`, `/fleet route`, `route_peer`)

Mission : exercer **pour de vrai** le conseil de modèles avec deux LLM Ollama locaux, le routage principal derrière `CODEBUDDY_COUNCIL_ROUTING`, et le lint de vie privée de `/fleet route` / `route_peer`.

- Clone autorisé : `/home/patrice/DEV/cb-repar-jumeaux-2026-09-02` uniquement
- Branche : `fix/gk27-council-reel-2026-09-03`
- HEAD au départ : `5e7639b426a7f22679b9db7fa118d7f41e9bebe4` (`Merge GK22 (skills en vrai : import, quarantaine, exchange signé, curation) into codex/audit-systeme-nerveux-2026-09-01`)
- Date : 2026-09-03 (Europe/Paris)
- Agent : Grok 4.6
- Rapport créé **avant** toute inspection de `src/council/`, `src/commands/council.ts`, `src/fleet/task-router.ts`, `src/fleet/model-selector.ts`
- Buddy invoqué depuis le clone : `node node_modules/tsx/dist/cli.mjs src/index.ts` (le lanceur `~/.local/bin/buddy` pointe vers `~/code-buddy`, interdit)
- HOME temporaire : `_qa/gk27/home`. Aucune écriture dans le vrai `~/.codebuddy`.
- Journaux réels **intacts, jamais touchés** (empreinte au départ) :
  - `~/.codebuddy/fleet-model-performance.jsonl` — 8465 octets, mtime 2026-09-02 19:54
  - `~/.codebuddy/council-deliberation-health.jsonl` — 2323 octets, mtime 2026-09-02 19:55

## Garde-fous (rappel)

- Aucun push, aucun `git prune` / `git reset --hard` / `rm -rf` / `git add -A` / `git commit -a`.
- Aucune API payante. Ollama local uniquement (`CODEBUDDY_PROVIDER=ollama`).
- Aucun service systemd. ComfyUI 8188/8189 non touché.
- Original `~/code-buddy` interdit.
- Un défaut = test rouge → correctif → vert, **un commit**.

## Parcours prévu (après inspection)

1. `buddy council "<question à réponse vérifiable>"` en pool `full` puis `registry` :
   - membres visibles ;
   - contrat VERDICT / CLAIMS / WOULD CHANGE MY MIND ;
   - juge qui s'abstient s'il est incertain ;
   - synthèse avec citation minoritaire si écart de scores > 0,3 ;
   - une ligne dans le journal de santé (HOME temporaire) ;
   - un membre mort (modèle inexistant) est pénalisé et remplacé.
2. `CODEBUDDY_COUNCIL_ROUTING=true` : le routage principal ne bascule qu'avec un historique réel (scoreboard vide ⇒ aucun changement).
3. `/fleet route` / `route_peer` sur un prompt avec IBAN factice → lint de vie privée.

## Journal

### 2026-09-03 — création du rapport (avant inspection)

HEAD `5e7639b42`. Arbre propre. Branche déjà `fix/gk27-council-reel-2026-09-03`. Ollama installé : `qwen3:4b-instruct` (2,5 Go) et `qwen3.8:27b` (17 Go), plus `qwen3.8-ctx32k`.
