# One-click web publish (`buddy deploy run`)

Build a static/web project and, **only with `--apply`**, send the output directory using the official Cloudflare Pages or Netlify CLI.

This is distinct from `buddy server` production hosting ([deployment.md](deployment.md)). It is also distinct from `buddy deploy init`, which only writes infrastructure configuration files for Fly / Railway / Render / Hetzner / Northflank / GCP / Nix and never uploads.

## What it does

1. Reads `.codebuddy/deploy.json` (or the `deploy` object in `.codebuddy/settings.json`).
2. Checks that `wrangler` (Cloudflare Pages) or `netlify` / `netlify-cli` (Netlify) is already installed on the machine.
3. Checks that an access token is present in the environment or the encrypted vault (`buddy secrets`).
4. Optionally executes the npm script named in `buildScript` (an npm script **name**, not an arbitrary shell string).
5. Checks that `outputDir` exists within the project boundaries.
6. With `--apply`, runs the vendor CLI with tokens passed strictly in the **child process environment**, never on the process argument list.

Default mode is simulation: `dryRun` is `true` unless `--apply` is explicitly passed. If both `--apply` and `--dry-run` are passed, **simulation wins** (`dryRun` remains active).

## Configuration (`.codebuddy/deploy.json`)

```json
{
  "target": "cloudflare-pages",
  "outputDir": "dist",
  "buildScript": "build",
  "projectName": "my-site"
}
```

| Field | Required | Default | Notes |
|:------|:---------|:--------|:------|
| `target` | yes | none | `"cloudflare-pages"` or `"netlify"` only |
| `outputDir` | no | `"dist"` | Must resolve strictly inside the project root |
| `buildScript` | no | `"build"` (if defined in `package.json`) | Single script name; spaces are rejected |
| `skipBuild` | no | `false` | When `true`, skips the build step |
| `projectName` | no | `package.json#name` (scope stripped) or directory basename | Cloudflare Pages project name |
| `accountId` | no | none | Passed as `CLOUDFLARE_ACCOUNT_ID` to wrangler |
| `siteId` | no | none | Passed as `NETLIFY_SITE_ID` to netlify |

## Commands (verified by execution)

```bash
buddy deploy --help
buddy deploy platforms
buddy deploy run --help
buddy deploy run                  # simulation in current directory
buddy deploy run ./my-app         # simulation of specified project
buddy deploy run ./my-app --json  # simulation report in JSON format
buddy deploy run ./my-app --apply # real deployment (requires CLI + token + dist)
```

### Command Options (`buddy deploy run [options] [dir]`)

- `dir`: Project directory (default: `"."`)
- `--dry-run`: Show the exact plan without uploading (default: `true`)
- `--apply`: Really upload (requires valid config, vendor CLI, token, and build output; default: `false`)
- `--json`: Print the structured report as JSON (secrets and tokens always omitted; default: `false`)
- `-h, --help`: Display help for command

## Tokens and Authentication

| Target | Environment variables (checked in order) | Vault fallback |
|:-------|:----------------------------------------|:---------------|
| Cloudflare Pages | `CLOUDFLARE_API_TOKEN` or `CF_API_TOKEN` | `buddy secrets set CLOUDFLARE_API_TOKEN <value>` |
| Netlify | `NETLIFY_AUTH_TOKEN` | `buddy secrets set NETLIFY_AUTH_TOKEN <value>` |

Tokens are never passed as command-line arguments. In reports, status is reported as `Token: NAME present (env|vault)` or `Token: NAME missing`. Raw token values are never displayed or stored in logs.

## Real Execution Outputs (Observed)

### 1. Missing target configuration (`buddy deploy run`)
```
One-click deploy — simulation (nothing sent)
Root: worktree cb-doc23-2026-09-18
Duration: 4 ms
  [error] config: No deploy target configured. Create .codebuddy/deploy.json with "target": "cloudflare-pages" or "netlify". Nothing was sent.
Error: No deploy target configured. Create .codebuddy/deploy.json with "target": "cloudflare-pages" or "netlify". Nothing was sent.
Rollback:
  Configure a target first (.codebuddy/deploy.json).
```
Exit code: 1. Nothing is sent.

### 2. Missing vendor CLI (`target: "cloudflare-pages"`, no wrangler)
```
[2026-09-17T23:45:27.166Z] ⚠️ WARN  [one-click-deploy] missing CLI for cloudflare-pages
One-click deploy — simulation (nothing sent)
Target: cloudflare-pages
Root: /tmp/test-deploy-cf
Duration: 8 ms
  [ok] config: target=cloudflare-pages outputDir=dist
  [error] tool: wrangler is not installed. Install Cloudflare Wrangler locally in the project (npm i -D wrangler) — Code Buddy will not download or install it.
Error: wrangler is not installed. Install Cloudflare Wrangler locally in the project (npm i -D wrangler) — Code Buddy will not download or install it.
Rollback:
  Cloudflare Pages can restore a previous deployment (rollback) when wrangler supports it; otherwise redeploy the previous build directory.
  $ wrangler pages deployment list --project-name test-app
  $ wrangler pages deployment rollback <previous-deployment-id> --project-name test-app
```
Exit code: 1.

### 3. Missing vendor CLI (`target: "netlify"`, no netlify-cli)
```
[2026-09-17T23:45:30.306Z] ⚠️ WARN  [one-click-deploy] missing CLI for netlify
One-click deploy — simulation (nothing sent)
Target: netlify
Root: /tmp/test-deploy-net
Duration: 12 ms
  [ok] config: target=netlify outputDir=dist
  [error] tool: netlify CLI is not installed. Install it locally in the project (npm i -D netlify-cli) — Code Buddy will not download or install it.
Error: netlify CLI is not installed. Install it locally in the project (npm i -D netlify-cli) — Code Buddy will not download or install it.
Rollback:
  Netlify restoreSiteDeploy republishes a previous deploy id. Keep the last successful deploy_id from the report.
  $ netlify api listSiteDeploys --data '{"site_id":"<site-id>"}'
  $ netlify api restoreSiteDeploy --data '{"site_id":"<site-id>","deploy_id":"<previous-deploy-id>"}'
```
Exit code: 1.

### 4. Missing Token (`target: "cloudflare-pages"`, wrangler present)
```
[2026-09-17T23:45:32.011Z] ⚠️ WARN  [one-click-deploy] missing token for cloudflare-pages
One-click deploy — simulation (nothing sent)
Target: cloudflare-pages
Root: /tmp/test-deploy-cf
Duration: 5 ms
Token: CLOUDFLARE_API_TOKEN missing
  [ok] config: target=cloudflare-pages outputDir=dist
  [ok] tool: /tmp/test-deploy-cf/node_modules/.bin/wrangler
  [error] token: Missing Cloudflare token. Set CLOUDFLARE_API_TOKEN (or CF_API_TOKEN) in the environment or `buddy secrets set CLOUDFLARE_API_TOKEN <value>`. The value is never written to the project.
```
Exit code: 1.

### 5. Successful Dry-Run Simulation (CLI and Token present)
```
[2026-09-17T23:45:33.618Z] ℹ️ INFO  [one-click-deploy] dry-run cloudflare-pages (nothing sent)
One-click deploy — simulation (nothing sent)
Target: cloudflare-pages
Root: /tmp/test-deploy-cf
Duration: 3 ms
Token: CLOUDFLARE_API_TOKEN present (env)
  [ok] config: target=cloudflare-pages outputDir=dist
  [ok] tool: /tmp/test-deploy-cf/node_modules/.bin/wrangler
  [ok] token: CLOUDFLARE_API_TOKEN present (env)
  [planned] build: would run project script "build" → npm run build
  [planned] output: would require directory dist
  [planned] upload: not sent (dry-run) → wrangler pages deploy dist --project-name test-app --commit-dirty=true
Rollback:
  Cloudflare Pages can restore a previous deployment (rollback) when wrangler supports it; otherwise redeploy the previous build directory.
  $ wrangler pages deployment list --project-name test-app
  $ wrangler pages deployment rollback <previous-deployment-id> --project-name test-app
```
Exit code: 0.

## What this feature does NOT do

- **Does NOT install vendor CLIs:** If `wrangler` or `netlify` is missing from the system and project `node_modules/.bin`, the command aborts immediately with a clear error. Code Buddy will never download or install CLI binaries.
- **Does NOT upload anything without `--apply`:** Dry-run is the mandatory default. Even if an upload command is constructed, it is only reported as `[planned] upload: not sent (dry-run)`.
- **Does NOT favor upload over simulation if conflicting flags are passed:** If both `--apply` and `--dry-run` are given, `--dry-run` wins.
- **Does NOT manage cloud provider accounts:** Does not create Cloudflare Pages projects from scratch, configure custom domains, or manage DNS records.
- **Does NOT perform cloud deployment for Fly, Railway, Render, Hetzner, Northflank, GCP, or Nix:** Those remain config generators under `buddy deploy init <platform>` or `buddy deploy nix`, which only generate template files and never connect to cloud APIs.
- **Does NOT allow arbitrary shell commands:** `buildScript` must match a specific npm script name in `package.json`. Values with shell operators, pipes, or spaces are rejected.
- **Does NOT expose tokens on CLI arguments:** All secrets are passed exclusively through child process environment variables.
- **Does NOT perform automated remote rollback:** Rollback instructions and vendor CLI commands are computed and printed, but must be run manually by the operator.
- **Does NOT allow directory traversal:** If `outputDir` points outside the project root (e.g. `../../etc`), the command fails immediately with `Directory escapes the project root`.
