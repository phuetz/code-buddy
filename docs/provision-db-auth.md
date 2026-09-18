# Database and authentication overlay (`buddy provision db-auth`)

Overlay versioned SQL migrations, a typed TypeScript client, and sign-up / sign-in / sign-out authentication views onto an existing or generated web project.

Default execution mode is **simulation** (dry-run): planned files and migration statuses are printed, and no files are written without `--apply`.

## Commands (verified by execution)

```bash
buddy provision --help
buddy provision db-auth --help
buddy provision db-auth --target local
buddy provision db-auth --target local --dir ./my-app --name demo-app
buddy provision db-auth --target local --dir ./my-app --json
buddy provision db-auth --target local --dir ./my-app --apply
buddy provision db-auth --target supabase --dir ./my-app
buddy provision db-auth --target supabase --dir ./my-app --apply
```

### Options (`buddy provision db-auth [options]`)

| Option | Type | Default | Description |
|:-------|:-----|:--------|:------------|
| `--target <supabase\|local>` | string | **required** | Backend: hosted Supabase (`supabase`) or local Postgres container (`local`) |
| `--dir <path>` | string | `"."` | Target web project directory |
| `--name <slug>` | string | directory basename | Project slug identifier |
| `--apply` | boolean | `false` | Really write files (default is dry-run simulation) |
| `--json` | boolean | `false` | Print execution plan as JSON (secret file contents omitted) |
| `--supabase-cli <bin>` | string | `"supabase"` | Supabase CLI executable name or path on `PATH` |
| `--token-env <name>` | string | `"SUPABASE_ACCESS_TOKEN"` | Name of environment variable containing Supabase token |
| `-h, --help` | flag | | Display help for command |

## Real Execution Outputs (Observed)

### 1. Missing Required `--target`
```
$ buddy provision db-auth
error: required option '--target <supabase|local>' not specified
```
Exit code: 1.

### 2. Simulation with `--target local`
```
$ buddy provision db-auth --target local
[2026-09-17T23:45:46.165Z] ℹ️ INFO  provision db-auth: dry-run 14 files for cb-doc23-2026-09-18 (local)
[2026-09-17T23:45:46.170Z] ℹ️ INFO  Simulation (no files written)
[2026-09-17T23:45:46.170Z] ℹ️ INFO  Target: local
[2026-09-17T23:45:46.170Z] ℹ️ INFO  Project: cb-doc23-2026-09-18
[2026-09-17T23:45:46.170Z] ℹ️ INFO  Directory: worktree cb-doc23-2026-09-18
[2026-09-17T23:45:46.171Z] ℹ️ INFO  Migrations:
[2026-09-17T23:45:46.171Z] ℹ️ INFO    - db/migrations/0001_init.sql  (pending, version 0001_init)
[2026-09-17T23:45:46.171Z] ℹ️ INFO  Files:
[2026-09-17T23:45:46.171Z] ℹ️ INFO    - create db/migrations/0001_init.sql
[2026-09-17T23:45:46.171Z] ℹ️ INFO    - create src/lib/database.ts
[2026-09-17T23:45:46.171Z] ℹ️ INFO    - create src/auth/AuthApp.tsx
[2026-09-17T23:45:46.171Z] ℹ️ INFO    - create src/auth/pages/SignIn.tsx
[2026-09-17T23:45:46.171Z] ℹ️ INFO    - create src/auth/pages/SignUp.tsx
[2026-09-17T23:45:46.171Z] ℹ️ INFO    - create src/auth/pages/SignOut.tsx
[2026-09-17T23:45:46.171Z] ℹ️ INFO    - create src/auth/README.md
[2026-09-17T23:45:46.171Z] ℹ️ INFO    - create src/main.tsx
[2026-09-17T23:45:46.171Z] ℹ️ INFO    - update .gitignore
[2026-09-17T23:45:46.171Z] ℹ️ INFO    - update .env.example
[2026-09-17T23:45:46.171Z] ℹ️ INFO    - create .env.local  [secrets omitted]
[2026-09-17T23:45:46.171Z] ℹ️ INFO    - create src/index.css
[2026-09-17T23:45:46.171Z] ℹ️ INFO    - create docker-compose.yml
[2026-09-17T23:45:46.171Z] ℹ️ INFO    - create db/README.md
[2026-09-17T23:45:46.171Z] ℹ️ INFO  Warnings:
[2026-09-17T23:45:46.171Z] ℹ️ INFO    - Local compose file is written; containers are not started.
[2026-09-17T23:45:46.171Z] ℹ️ INFO  Next:
[2026-09-17T23:45:46.171Z] ℹ️ INFO    - Re-run with --apply to write these files (still no remote project, still no docker start).
[2026-09-17T23:45:46.171Z] ℹ️ INFO    - Keys are never printed; .env.local is gitignored.
```
Exit code: 0.

### 3. Simulation with `--target supabase` (Missing Token)
```
$ buddy provision db-auth --target supabase
[2026-09-17T23:45:48.259Z] ❌ ERROR Supabase access token missing. Set SUPABASE_ACCESS_TOKEN (or CODEBUDDY_SUPABASE_ACCESS_TOKEN) in the environment; do not pass the value on the command line. {"code":"MISSING_TOKEN"}
```
Exit code: 1.

### 4. Simulation with `--target supabase` (Token present, missing Supabase CLI)
```
$ SUPABASE_ACCESS_TOKEN=xxx buddy provision db-auth --target supabase
[2026-09-17T23:45:50.266Z] ❌ ERROR Supabase CLI "supabase" was not found on PATH. Install it locally; Code Buddy will not download it or create a remote project. {"code":"MISSING_CLI"}
```
Exit code: 1.

### 5. Simulation with `--target supabase` (Token and Supabase CLI present)
```
$ SUPABASE_ACCESS_TOKEN=xxx buddy provision db-auth --target supabase --supabase-cli /path/to/supabase
[2026-09-17T23:45:52.289Z] ℹ️ INFO  provision db-auth: dry-run 13 files for cb-doc23-2026-09-18 (supabase)
[2026-09-17T23:45:52.291Z] ℹ️ INFO  Simulation (no files written)
[2026-09-17T23:45:52.291Z] ℹ️ INFO  Target: supabase
[2026-09-17T23:45:52.291Z] ℹ️ INFO  Project: cb-doc23-2026-09-18
[2026-09-17T23:45:52.291Z] ℹ️ INFO  Directory: worktree cb-doc23-2026-09-18
[2026-09-17T23:45:52.291Z] ℹ️ INFO  Migrations:
[2026-09-17T23:45:52.291Z] ℹ️ INFO    - supabase/migrations/0001_init.sql  (pending, version 0001_init)
[2026-09-17T23:45:52.291Z] ℹ️ INFO  Warnings:
[2026-09-17T23:45:52.291Z] ℹ️ INFO    - No remote Supabase project will be created. Token is used only as a presence check.
[2026-09-17T23:45:52.291Z] ℹ️ INFO  Next:
[2026-09-17T23:45:52.291Z] ℹ️ INFO    - Re-run with --apply to write these files (still no remote project, still no docker start).
[2026-09-17T23:45:52.291Z] ℹ️ INFO    - Keys are never printed; .env.local is gitignored.
```
Exit code: 0.

## What this feature does NOT do

- **Does NOT create a remote project on Supabase or any cloud service:** Even when provided with `SUPABASE_ACCESS_TOKEN` and the `supabase` CLI binary, Code Buddy only checks for their presence. It does not call any Supabase management APIs or provision cloud resources.
- **Does NOT start Docker containers:** When using `--target local`, a `docker-compose.yml` file is generated, but `docker compose up` is not executed. The operator must start local containers manually.
- **Does NOT execute SQL migrations against any database:** Migrations are written as schema files into `db/migrations/` or `supabase/migrations/`. They are not applied to live Postgres or Supabase instances.
- **Does NOT overwrite an already-applied migration:** If migration `0001_init` is already applied according to the tracker, the command halts with error code `MIGRATION_APPLIED`.
- **Does NOT write files without `--apply`:** By default, it operates in read-only simulation mode.
- **Does NOT expose credentials in logs or console:** All generated or detected keys in `.env.local` are omitted in output (`[secrets omitted]`).
- **Does NOT accept API tokens as command-line arguments:** The token must be set in environment variables (`SUPABASE_ACCESS_TOKEN` or `CODEBUDDY_SUPABASE_ACCESS_TOKEN`), preventing token leakage in process tables (`ps aux`) and shell histories.
- **Does NOT download or install the Supabase CLI:** The CLI binary must be installed by the user and available on `PATH`.
