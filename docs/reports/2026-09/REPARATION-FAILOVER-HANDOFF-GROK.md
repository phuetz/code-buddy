# REPARATION-FAILOVER-HANDOFF-GROK — repli utilisable vers un modèle local

Date : 2026-09-06 (Europe/Paris)
Agent : Grok 4.6
Worktree : `~/DEV/cb-failover-2026-09-06`
Branche : `fix/failover-handoff-2026-09-06`
HEAD au départ : `88a27ddc0` (`docs(audit): etude source omniroute 3.8.49 vs code buddy failover et handoff`)
Original `~/code-buddy` : interdit (jamais ouvert, jamais écrit)
Rapport créé **avant toute inspection**.
HOME temporaire : `_qa/fo/home`. Aucune écriture dans le vrai `~/.codebuddy`.
Copie lecture seule de `~/.codebuddy/codex-auth.json` vers le HOME isolé autorisée pour l'essai réel, jamais affichée.
Ollama : `http://127.0.0.1:11435`. Modèles autorisés : `qwen3:4b-instruct` et `qwen3.8-ctx32k:latest` uniquement.

Étude source : `docs/audits/2026-09-06-etude-omniroute-failover-agy.md`.
Constat de l'étude : repli ChatGPT 429 → Ollama réussit SANS outils en 1,2 s ; AVEC les outils de l'agent il échoue en 400 (~60 k tokens de définitions d'outils pour une fenêtre de 32 k) et l'erreur 400 est masquée par le 429 initial.

## Mission

Rendre le repli de fournisseur réellement utilisable vers un modèle local (5 améliorations de l'étude OmniRoute) :

1. Élagage des outils au handoff (RAG ≤ N + outils déjà appelés + `tool_search`, puis compactage, budget `contextWindow(cible) − maxOutputTokens − marge 10 %`).
2. Pré-filtrage par capacité (sauter une cible trop petite avec journal `[fallback] <cible> ignorée (contexte 32 k < 41 k)`).
3. Diagnostic honnête (429 initial + chaque échec de cible ; parole Lisa « cerveau de secours n'a pas suffi »).
4. Événement vers l'utilisateur (ligne discrète une fois par bascule + une fois au retour, compagnon/Telegram/PWA ; rien si flag off).
5. Unification `CODEBUDDY_LLM_FAILOVER` → alias documenté de `CODEBUDDY_PROVIDER_FALLBACK`.
6. Preuves Vitest + tsc + lint + essai réel avec outils.

## Garde-fous

- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Vitest : `HOME=~/DEV/cb-failover-2026-09-06/_qa/fo/home` et `env -u FORCE_COLOR`.
- Ports ≥ 5000. ComfyUI 8188/8189 non touché.
- Jamais `/home/<user>` ni prénom dans les fichiers suivis (écrire `~`).
- Un commit par point. `git add` fichier par fichier.
- Pas de verdict dans ce rapport (le pilote le fera).

## Journal

### 2026-09-06 — création du rapport (avant inspection)

HEAD `88a27ddc0`. Branche déjà extraite. Réservation à commiter.
