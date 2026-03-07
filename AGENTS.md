# Repository Guidelines

## Environment & Setup
- Runtime: `Node.js >= 18`.
- Install: `npm install`, then copy `.env.example` to `.env` and set required keys.
- Use one package manager per branch (`npm` default; `bun` optional) to avoid lockfile churn.

## Project Structure & Module Organization
- `src/`: main TypeScript codebase (CLI entry: `src/index.ts`).
- `tests/`: Vitest suites (`*.test.ts`, `*.spec.ts`) with feature/integration coverage.
- `scripts/`, `benchmarks/`: utilities and performance checks.
- `docs/`, `examples/`, `assets/`: docs, sample config, diagrams.
- `dist/`, `coverage/`: generated output, never edit manually.
- `vscode-extension/`, `extensions/vscode/`: extension-specific code.

## Build, Test, and Development Commands
- `npm run dev` or `npm run dev:node`: run CLI from source.
- `npm run build` then `npm start`: compile and run `dist/index.js`.
- `npm test`, `npm run test:watch`, `npm run test:coverage`: run tests and coverage.
- `npm run lint`, `npm run lint:fix`, `npm run typecheck`: quality gates.
- `npm run validate`: lint + typecheck + tests.

## Coding Style & Naming Conventions
- Prettier: single quotes, semicolons, 2 spaces, 100-char width.
- `.editorconfig`: LF line endings and UTF-8.
- ESLint + `@typescript-eslint`: required; avoid `any`, prefer explicit types.
- Naming: kebab-case files (`tool-orchestrator.ts`), camelCase functions, PascalCase types/classes, UPPER_SNAKE_CASE constants.

## Testing Guidelines
- Framework: Vitest (`happy-dom` test environment).
- Test file patterns: `tests/**/*.{test,spec}.{ts,tsx}` and `src/**/*.{test,spec}.{ts,tsx}`.
- Coverage thresholds are enforced at 70% for lines, functions, branches, and statements.
- Keep tests deterministic; mock API, filesystem, and network side effects.
- Scope guidance: small fix `npm test -- <pattern>`; module refactor `npm test && npm run typecheck`; broad change `npm run validate`.

## Fast Contribution Workflow
1. Create a branch (`feat/...`, `fix/...`, `docs/...`).
2. Implement changes with focused tests.
3. Run `npm run validate`.
4. Commit using Conventional Commits.
5. Open a PR with issue links and validation evidence.

## Commit & Pull Request Guidelines
- Commits must follow Conventional Commits (`feat`, `fix`, `docs`, `test`, `refactor`, `chore`, etc.); enforced by Husky + commitlint.
- Subject line max length: 100 characters.
- Examples: `feat(agent): add retry policy for tool execution`, `fix(security): harden path validation`.
- Pre-commit runs `lint-staged`; pre-push runs `npm run test:coverage` and `npm audit --audit-level=moderate`.
- PRs should include: problem/solution summary, linked issue(s), test evidence, and docs updates for behavior changes.

## Security & Config Tips
- Never commit secrets; keep credentials in `.env` only.
- Update `.env.example` when adding new required configuration.
