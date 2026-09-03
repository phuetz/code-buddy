# RAPPORT GK18 — `buddy dev plan|run|pr|fix-ci` (golden paths) en vrai

Date : 2026-09-03  
Agent : Grok 4.6  
Clone : `/home/patrice/DEV/cb-repar-context-2026-09-02`  
Branche : `fix/gk18-dev-golden-path-2026-09-03`  
Base : `587bbc3ae` (`Merge GK4/GK4b`)

Ce rapport a été créé **avant** toute inspection des sources `src/commands/dev*.ts`, `src/security/write-policy.ts` et `tests/commands/dev/`, puis complété au fil de l'eau.

## Contraintes

- Clone uniquement. Original `~/code-buddy` non touché.
- Aucun `git push`, `git prune`, `git reset --hard`, `rm -rf`, `git add -A`, `git commit -a`.
- Aucune API payante. Ollama local uniquement.
- Aucun service (ComfyUI 8188/8189, buddy 3000/3001) touché.
- HOME temporaire dans le clone. Jamais `~/.codebuddy`.
- Dépôt jouet `_qa/gk18-jouet/` avec remote factice `git init --bare`.
- `pr` doit produire titre/corps et échouer proprement sans `gh` authentifié, ou cibler le remote factice.

## Mission

Parcours réel : `buddy dev plan "corrige le bug"` → `buddy dev run` (WritePolicy.strict, `apply_patch` only) → tests verts → `buddy dev pr` → `buddy dev fix-ci` sur CI factice cassée.

Chaque défaut (plan vide annoncé réussi, écriture hors patch, commit sans message conventionnel, `pr` qui « réussit » sans PR, `fix-ci` qui boucle, sortie polluée, doc fausse) : test rouge → correctif → vert, un commit.

## Journal

### 0. Ouverture

Rapport créé. Inspection à suivre.
