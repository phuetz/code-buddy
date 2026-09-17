# Mission Grok — Provisionnement base + authentification (bolt.new point 3)

**STATUT : COMPLET LOCAL** (pas de commit, pas de push) — corrections après contre-revue AGY du 18/09/2026

- Worktree : `worktree cb-supabase-2026-09-17`
- Branche : `feat/supabase-2026-09-17`
- Base : `origin/main` `b5c50c189`
- Contraintes tenues : pas de commit, pas de `rm -rf` hors nettoyage de tests tmp, aucun projet distant, aucun appel réseau dans les tests.

## Constat

Le dépôt savait déjà :

- Gabarits `src/templates/project-scaffolding.ts` (`react-ts`, `react-tailwind`, `express-api`, `node-cli`).
- Outil `scaffold_app`.
- `.gitignore` web avec `.env` / `.env.local`.
- Variable `database` du gabarit Express **non câblée**.
- « Supabase » = design system + détecteur de secrets, pas un provisionnement.

Pas de couche parallèle : overlay sous `src/templates/db-auth/` + `buddy provision db-auth` (même style que `buddy deploy`).

## Code

- `src/templates/db-auth/` — plan, artefacts SQL/TSX, typecheck hors réseau.
- `src/commands/cli/provision-command.ts` — CLI lazy `provision db-auth`.
- `src/index.ts` — enregistrement du groupe.
- Tests : `tests/templates/db-auth-provision.test.ts`.

Simulation par défaut. `--apply` écrit localement. Le jeton Supabase n’est qu’une preuve de présence. Jamais `supabase projects create`.

## Vérifications

| Commande | Résultat |
|---|---|
| `npx vitest run tests/templates/db-auth-provision.test.ts` | 10/10 (après contre-revue) |
| `npx vitest run tests/templates/project-scaffolding.test.ts` | 7/7 (régression gabarits) |
| `npx tsc --noEmit -p tsconfig.json` | 0 erreur sur le delta ; 2 erreurs préexistantes `@phuetz/companion-core` |
| `npx eslint --quiet` (fichiers touchés) | 0 |

## Livrable utilisateur

`Partage/20260917-cowork-comparaison/PROVISIONNEMENT-BASE.md`

## Corrections après contre-revue

Contre-revue `REVUE-AGY-supabase.md` (AGY, 18/09/2026) : **À CORRIGER**. Session Grok 4.6 du 18/09/2026 — pas de commit, pas de projet distant, pas d’appel réseau dans les tests.

### 1. `fetchOwnProfile` fonctionne sur les deux cibles

Le client généré ne tape plus `${url}/rest/v1/profiles` en aveugle.

- **local** : RPC `public.get_own_profile(p_token)` (security definer) + `GRANT EXECUTE` ; le client appelle `POST ${url}/rpc/get_own_profile` avec le jeton opaque de `public.sessions` (pas un JWT PostgREST). Pas de `GRANT SELECT` large sur `profiles`.
- **supabase** : `GET ${url}/rest/v1/profiles?id=eq.…` avec le JWT d’auth + `apikey` ; SQL d’init : `GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated` (RLS déjà en place).
- `AuthApp.tsx` charge le profil (plus de code mort).

**Test :** `fetchOwnProfile uses PostgREST rpc locally and /rest/v1 on supabase (mocked fetch, no network)` — client transpiled, `fetch` mocké, URLs `http://127.0.0.1:3001/rpc/get_own_profile` et `https://example.supabase.invalid/rest/v1/profiles?…`. Le SQL local est aussi asserté dans le test d’overlay local (`get_own_profile` + grant).

### 2. Cible Supabase exercée en `--apply`

**Test :** `applies supabase overlay with a simulated CLI executor without network or a remote project`.

`provisionDbAuth({ target: 'supabase', apply: true })` avec `commandExists` simulé (`['supabase']`) et `globalThis.fetch` qui échoue si appelé. 13 fichiers écrits, `supabase/migrations/0001_init.sql` (RLS, policies, trigger, grant `authenticated`), typecheck du projet, jeton absent des sorties. Aucun spawn, aucun compte.

### 3. Permissions `.env.local`

`writePlan` fait `fs.chmod(abs, 0o600)` après `writeFile` pour les fichiers secrets (`writeFile({ mode })` ignore un fichier déjà présent).

**Test :** `chmods an already-existing .env.local from world-readable to 0600` (`skipIf` win32). Fichier préexistant `0644` → `0600`, contenu remplacé.

### Robustesse mineure retenue

- Plus de génération de secrets dans le plan (le corps de `.env.local` n’existait que pour être jeté).
- README local : les sessions locales sont des jetons opaques ; le profil passe par le RPC.

### Preuve

| Commande | Résultat |
|---|---|
| `npx vitest run tests/templates/db-auth-provision.test.ts` | 10/10 |
| `npx vitest run tests/templates/project-scaffolding.test.ts` | 7/7 |
| `npx tsc --noEmit -p tsconfig.json` | 0 erreur sur le delta ; 2 préexistantes `@phuetz/companion-core` |
| `npx eslint --quiet` (fichiers du périmètre) | 0 |

Pas de commit.
