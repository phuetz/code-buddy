# RAPPORT GK29 — Trois innovations « Code Buddy 2 » en vrai : Shadow Workspace, Time-Travel Sessions, Intent Ledger

Date : 2026-09-03
Agent : Grok 4.6
Clone : `/home/patrice/DEV/cb-repar-cowork-2026-09-02`
Branche : `fix/gk29-cb2-reel-2026-09-03`
HEAD au démarrage : `d0e067392` (`Merge GK23 (rappels de Lisa en vrai) into codex/audit-systeme-nerveux-2026-09-01`)
Original `~/code-buddy` : interdit (jamais ouvert, jamais écrit)
Rapport créé **avant toute inspection** du code CB2 (`src/speculative/`, `src/sessions/timeline.ts`, `src/intents/`, commandes `shadow`/`replay`/`intents`, tests, fiches `docs/cb2/`).

## Mission

Éprouver **pour de vrai** trois innovations opt-in Code Buddy 2, dans un dépôt jouet, agent headless Ollama, HOME temporaire dans le clone :

1. **Shadow Workspace** (`CODEBUDDY_SHADOW_WORKSPACE=true`) : une édition est validée dans le worktree fantôme **avant** de toucher les fichiers ; une édition qui casse les tests est **rejetée sans toucher le dépôt** (preuve sha256 avant/après) ; `buddy shadow` liste/nettoie.
2. **Time-Travel Sessions** (`CODEBUDDY_TIMELINE=true`) : trois tours → `buddy replay` liste ; `restore` d'un tour antérieur remet **exactement** l'état ; `fork` crée une branche de session.
3. **Intent Ledger** (`CODEBUDDY_INTENTS=true`) : `buddy intents` déclare une spec falsifiable (« le test X passe ») ; une édition qui la viole est signalée comme **dérive**.

Sans les variables : comportement **byte-identique** (test).

Loi : « se servir de ses applis EN VRAI ». Chaque défaut (validation fantôme qui laisse passer, restore partiel, dérive non détectée, doc fausse) : test rouge → correctif → vert, un commit.

## Garde-fous

- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Aucune API payante. Ollama local uniquement.
- Aucun service systemd. ComfyUI 8188/8189 non touché.
- HOME temporaire `_qa/gk29/home` (et workdirs `_qa/gk29/work/*`) dans le clone seulement. Le vrai `~/.codebuddy` n'est pas écrit.
- Buddy invoqué depuis le clone : `node node_modules/tsx/dist/cli.mjs src/index.ts` (le lanceur `~/.local/bin/buddy` pointe vers `~/code-buddy`, interdit).
- Un commit conventionnel par lot, fichiers nommés un par un.

## Journal

| Heure (Europe/Paris) | Action |
|---|---|
| 12:45 | Rapport créé **avant inspection**. Coordination à réserver. |

## Fichiers lus

*(vide — inspection pas commencée)*

## Écarts

*(aucun encore)*

## Tableau final « scénario → attendu → obtenu → correctif → commit »

| Scénario | Attendu | Obtenu | Correctif | Commit |
|---|---|---|---|---|
| *(à remplir après parcours réel)* | | | | |
