# Mission Grok — backend d'exécution SSH (Hermes point 1)

**STATUT : COMPLET EN LOCAL** (2026-09-17) — pas de commit, pas de push, pas de publication.

- Agent : Grok 4.6
- Worktree : `cb-ssh-sandbox-2026-09-17`
- Branche : `feat/ssh-sandbox-2026-09-17`
- Base : `origin/main` `b5c50c189` (2.2.0)
- Livrable : `SSH-BACKEND.md`

## Garde-fous respectés

- Rapport créé avant inspection.
- Pas de `git commit`, pas de `rm -rf`, pas de publication.
- Backend SSH `explicitOnly` : `getActiveSandboxBackend()` ne le choisit jamais.
- Aucune clé ni mot de passe dans les fichiers suivis.
- HoteExemple : aucune commande distante exécutée (la session a bloqué SSH distant). `ssh -G hoteExemple` seulement (config locale).

## Livraison

- `src/sandbox/ssh-hosts.ts` — catalogue déclaré, refus des secrets, `StrictHostKeyChecking=no` interdit.
- `src/sandbox/ssh-sandbox.ts` — contrat sandbox, BatchMode, timeout double, kill distant, sorties bornées, execpolicy.
- `src/sandbox/sandbox-registry.ts` — `explicitOnly`, `getSandboxBackendByName`, `sandboxExecuteOn`.
- `src/sandbox/auto-sandbox.ts` — SSH uniquement si `explicitBackend === 'ssh'`.
- `src/tools/bash/execution-policy.ts` — branche explicite, pas de repli local.
- Tests : `tests/sandbox/ssh-sandbox.test.ts` (+ registre / auto-sandbox).

## Vérifications

| Commande | Résultat |
|---|---|
| `npx vitest run tests/sandbox/ssh-sandbox.test.ts tests/sandbox/sandbox-registry.test.ts tests/sandbox/auto-sandbox.test.ts` | 3 fichiers / **40 verts** |
| `npx vitest run tests/tools/bash-execution-policy.test.ts tests/sandbox/os-sandbox.test.ts` | 2 fichiers / **24 verts** |
| `npx eslint --quiet` (fichiers touchés) | 0 erreur |
| `npx tsc --noEmit` | 0 erreur |
| `git diff --check` | 0 |

`npm run validate` global non lancé (lint+27k tests). Équivalent ciblé ci-dessus.

## Prochaine action sûre

Examens humains, puis commits proposés dans `SSH-BACKEND.md` (`git add` nommé). Jamais de fusion ni npm publish depuis ce worktree.
