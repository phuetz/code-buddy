# Contributing to Code Buddy

Thank you for helping make Code Buddy better. Small, focused pull requests are
welcome, including documentation and test improvements.

By participating, you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).
Please report vulnerabilities privately as described in
[SECURITY.md](SECURITY.md).

## Five-minute setup

Development and tests require Node.js 20 or newer, npm, Git, and a recent
version of ripgrep (`rg`). Bun is optional.

```bash
git clone https://github.com/YOUR_USERNAME/code-buddy.git
cd code-buddy
npm install
npm run dev:node -- --help
```

No API key is needed to run the test suite. To try a provider, copy
`.env.example` to `.env` and add only the credentials needed for that provider.
Never commit `.env` or credentials.

## Pick an issue and create a branch

New contributors can start with a
[`good first issue`](https://github.com/phuetz/code-buddy/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22).
Before doing substantial work, comment on the issue so contributors do not
duplicate effort.

```bash
git fetch origin
git switch -c fix/short-description origin/main
```

Keep a pull request focused on one change. Branch names such as
`fix/short-description`, `feat/short-description`, `docs/short-description`, and
`test/short-description` are easy to scan.

### Using Git worktrees

Worktrees are useful when you have several contributions in flight:

```bash
git fetch origin
git worktree add ../code-buddy-my-change -b fix/my-change origin/main
cd ../code-buddy-my-change
npm install
```

Use one branch per worktree. Do not check out the same branch in two worktrees,
and run commands from the worktree you intend to change. Remove a worktree only
after its changes are committed or otherwise backed up.

## Develop and test

Run the narrowest relevant test while iterating:

```bash
npm test -- tests/path/to/file.test.ts
```

Tests live in `tests/`; do not add in-source `src/**/*.test.ts` files. Add or
update tests for observable behavior, including failure and boundary cases.
Before requesting review, run the complete validation gate:

```bash
npm run validate
```

That command runs lint, TypeScript checks, and the full Vitest suite. The suite
is large, so a path-filtered test is preferred during development. If an
environment-specific check cannot run locally, state exactly what you did run
in the pull request.

For the Electron app, install its dependencies separately and use its own
commands:

```bash
cd cowork
npm install
npm test
```

See [the getting-started guide](docs/getting-started.md),
[the fleet guide](docs/fleet-guide.md), and
[`cowork/ARCHITECTURE.md`](cowork/ARCHITECTURE.md) for subsystem details.

## Code conventions

- TypeScript is strict. Avoid `any`; prefer a precise type or `unknown` plus
  validation.
- This is an ESM project. Source imports use `.js` extensions even when the
  source file is `.ts`.
- Use single quotes, semicolons, two-space indentation, and kebab-case file
  names. React components use PascalCase.
- Use `logger` from `src/utils/logger.ts` rather than `console.*` in production
  code.
- Keep tests in `tests/` and mirror the source area in the test path when
  practical.
- Preserve lazy loading at CLI and agent entry points; avoid pulling heavy
  modules into startup paths.

Repository-specific testing traps and architecture notes are documented in
[`AGENTS.md`](AGENTS.md). Read the relevant source and nearby tests before
changing a subsystem.

## Commits and pull requests

Commit messages follow
[Conventional Commits](https://www.conventionalcommits.org/):

```text
feat(fleet): add peer latency filter
fix(cli): preserve profile during restart
test(memory): cover empty fact updates
docs: clarify local Ollama setup
```

Use an imperative, lower-case summary and add a scope when it helps. Breaking
changes require a `!` or a `BREAKING CHANGE:` footer.

A pull request should explain the problem and solution, link the issue when one
exists, list the checks run, and update user-facing documentation when behavior
changes. Please keep generated files and unrelated formatting out of the diff.

## Getting help

Use a
[question issue](https://github.com/phuetz/code-buddy/issues/new/choose) for
reproducible project questions. Include your Code Buddy version, Node version,
operating system, install method, provider/model when relevant, and sanitized
logs. Never post API keys, tokens, private prompts, or repository secrets.
