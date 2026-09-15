# Releasing `@phuetz/code-buddy`

Stable releases use `.github/workflows/release.yml`: pushing a reviewed `vX.Y.Z`
tag runs the release checks, publishes to npm using trusted publishing (OIDC),
then creates the GitHub release and attaches the package tarball. Do not run a
second publisher for the same version.

`2.0.0` is already published. Existing published versions and tags, including
`v2.0.0`, are immutable: never delete or move them to restart version numbering.
The manually triggered semantic-release workflow is a separate, dormant route;
it is not part of this procedure. Its dry run is not a publication approval.

## Prepare a release candidate

1. Fetch current `origin/main` and tags. Start a dedicated release branch from
   that current main, preserving remote changes. Integrate reviewed commits.
2. Inspect `npm view @phuetz/code-buddy version dist-tags versions --json` and
   select an unused SemVer version: a minor release for compatible new features,
   a patch for fixes, and a major version for breaking changes.
3. Update `package.json`, the root entries in `package-lock.json`, `CHANGELOG.md`,
   and `docs/RELEASE-NOTES-X.Y.Z.md`. Keep README installation instructions and
   feature limitations consistent. Cowork is a separate package and release.
4. Run `npm run validate` with appropriate test path filters for the change,
   plus the deterministic release suites `npm test -- tests/fleet tests/kanban`
   and `node scripts/ci-audit-gate.mjs`. Build and inspect a fresh package.
5. Check the tarball contents, version, runtime manifest and SHA256. No secrets,
   private profiles, absolute developer paths or test state may ship. Test the
   installed package with normal dependency installation in a private prefix;
   an `--ignore-scripts`/`--omit=optional` smoke is not a native installation test.
6. Push the branch and open a PR targeting main. The CI workflow triggers on
   these PRs and main/develop pushes, not on arbitrary release-branch pushes.
   Inspect every Node20/22 × Linux/Windows/macOS job. All matrix jobs are gating
   in the workflow; a local pass does not establish a remote CI pass. Record any
   unresolved failure and obtain a technical disposition before proceeding.

Do not change branch protections or weaken CI to make a release appear green.
Repository protection settings and workflow success are different controls.

## Publish once, from the reviewed main commit

After the concrete candidate, package and CI results pass final technical review:

1. Merge the reviewed PR without overwriting concurrent changes. Fetch main
   again and check the exact resulting commit and version.
2. Verify that the npm version and tag are still unused, and that package.json
   matches the intended tag. Create an annotated tag at that exact main commit
   and push only that tag, for example `v2.1.0` for package version `2.1.0`.
3. Follow the **Release** workflow (`release.yml`). It installs dependencies,
   rebuilds SQLite for the runner ABI, type-checks, lints, builds, runs the audit
   gate and fleet/kanban smoke, then publishes via npm trusted publishing.
   The workflow grants `id-token: write`; never substitute a printed or copied
   personal token for its OIDC identity.
4. Verify npm's version/dist-tag, integrity and provenance, the GitHub release
   and attached tarball, and a fresh installed-package smoke. Report the actual
   published version and links only after these checks.

`prepublishOnly` cleans and builds; `prepack` builds, strips source maps and writes
`dist/codebuddy-runtime.json`. The final workflow package can therefore differ in
build metadata from a local preview. Compare the published artifact, not just its
version string. Build timestamps and source revisions are not interchangeable.

## If publication is interrupted

Read the workflow steps and npm registry state before retrying. Publication can
succeed while GitHub release creation fails. Never attempt to overwrite a version
already present on npm, move a published tag, or trigger both release workflows.
If npm succeeded, repair only the missing GitHub release/asset stage against the
published version. If npm did not publish, diagnose the failing gate or trusted
publisher configuration before retrying the appropriate operation.

For prereleases, deliberately choose an unused prerelease version and a non-latest
dist-tag in a separately reviewed process. The stable tag workflow does not provide
an automatic RC channel. Do not infer one from old `rc` dist-tags.
