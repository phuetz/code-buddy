# Releasing `@phuetz/code-buddy`

This package had a stale-npm problem (published `latest` = `0.4.0` while the repo
sat at `1.0.0-rc.8`) because publishing was fully manual and easy to forget. This
doc captures the two release paths and the guard rails that prevent that recurring.

## TL;DR — which path do I use?

| Situation | Path |
|---|---|
| Ship another **release candidate** (`1.0.0-rc.9`, …) | **Manual** — `npm publish --tag rc` |
| Cut a **stable** release (`1.0.0`, `1.1.0`, …) once you decide it's ready | **semantic-release** — the `Release (semantic-release)` workflow |

Both run `prepublishOnly` (clean + fresh build) and `prepack` (strip ~14 MB of
source maps) automatically, so the tarball stays lean (~5.4 MB packed) and always
matches source.

---

## Path A — Manual RC publish (current default while < 1.0.0)

```bash
npm version 1.0.0-rc.9 --no-git-tag-version   # bump (or edit package.json)
npm publish --tag rc --access public          # → installs via @rc, leaves `latest` alone
```

- Requires `npm whoami` to return `phuetz`.
- Under 2FA you need either an OTP (`--otp=123456`) **or** a granular token with
  "bypass 2FA" in `~/.npmrc`. The web-login token alone **cannot** publish.
- `latest` intentionally stays on the last stable so `npm i @phuetz/code-buddy`
  never serves an RC by surprise.

Verify the tarball before publishing:

```bash
npm pack --dry-run        # confirms prepack stripped maps; check size + file count
```

---

## Path B — Automated stable release (semantic-release)

semantic-release is installed and configured (`.releaserc.json`). It derives the
version from Conventional Commits, writes `CHANGELOG.md`, bumps `package.json`,
tags, publishes to npm, and opens the GitHub Release — no manual version juggling.

**Trigger:** GitHub → Actions → **Release (semantic-release)** → *Run workflow*.
It is `workflow_dispatch` only (never auto-fires on push) and **defaults to a dry
run** — you must set `dry_run = false` to actually publish.

Preview locally first:

```bash
npm run release:dry       # prints "The next release version is X"
```

### ⚠️ Three prerequisites before the first real run

1. **`NPM_TOKEN` repo secret** — an npm **automation/granular** token with
   *bypass two-factor authentication* enabled. (Settings → Secrets and variables →
   Actions.) A plain token fails under 2FA exactly like the manual web-login did.

2. **Delete the orphan `v2.0.0` tag.** It is an ancestor of `main`, so
   semantic-release treats `2.0.0` as the baseline and would compute a `2.x`
   version, **skipping `1.0.0` entirely**. Your call (nothing `2.x` was ever
   published, so deleting it is almost certainly safe):
   ```bash
   git tag -d v2.0.0
   git push origin :refs/tags/v2.0.0
   ```

3. **`main` cuts STABLE.** `.releaserc.json` has `branches: ["main"]` with no
   prerelease channel, so a real run publishes to the `latest` dist-tag. Only arm
   it when you mean to ship 1.0.0-stable. Until then, keep using Path A for RCs.

### Relationship to the existing `release.yml`

The older tag-triggered `.github/workflows/release.yml` (fires on `v*` tags,
publishes to `latest`) is left in place but is **superseded** by Path B. Pick one:
once semantic-release is proven on a real run, retire `release.yml` to avoid a
double publish (a semantic-release-created `v*` tag could otherwise re-trigger it;
its release commit carries `[skip ci]`, which GitHub honors, but don't rely on
that long-term).

---

## Pre-release checklist

- [ ] CI green on `main` (`npm run validate` locally for a fast gate)
- [ ] `npm pack --dry-run` shows no `*.js.map` and a sane file count
- [ ] (Path B) `NPM_TOKEN` secret set, `v2.0.0` deleted, you intend stable
- [ ] CHANGELOG reflects the release (semantic-release does this for Path B)
