---
name: project-best-practices
version: 1.0.0
description: Best practices for initializing and structuring software projects
author: Code Buddy
tags: project, init, architecture, best-practices
---

# Project Best Practices

When creating or scaffolding a new project, follow these guidelines.

## Project Initialization

1. **Always start with a package manager lockfile** — run `npm init -y` (or `pnpm init`) then install dependencies to generate a lockfile immediately.
2. **Use TypeScript by default** — unless the user explicitly asks for JavaScript. Configure `strict: true` in `tsconfig.json`.
3. **Add a `.gitignore`** from the start — include `node_modules/`, `dist/`, `.env`, coverage reports, OS files.
4. **Initialize git** — `git init` with an initial commit after scaffolding.
5. **Create a README.md** — with project name, description, setup instructions, and available scripts.

## Directory Structure

Follow a standard layout based on project type:

### Node.js / Backend
```
src/
  index.ts          # Entry point
  routes/           # HTTP route handlers
  services/         # Business logic
  models/           # Data models / schemas
  utils/            # Shared utilities
  middleware/       # Express/Fastify middleware
  types/            # TypeScript type definitions
tests/              # Test files mirroring src/
.env.example        # Environment variable template (never commit .env)
```

### Frontend (React/Vue/Svelte)
```
src/
  components/       # Reusable UI components
  pages/            # Route-level views
  hooks/            # Custom hooks
  services/         # API client / business logic
  utils/            # Helpers
  types/            # TypeScript types
  assets/           # Static files (images, fonts)
public/             # Public static assets
```

### Library / Package
```
src/
  index.ts          # Public API exports
  lib/              # Internal implementation
  types/            # Type definitions
tests/
examples/           # Usage examples
```

## Code Quality

1. **Linter** — Add ESLint with a flat config (`eslint.config.js`). Prefer `@typescript-eslint` rules.
2. **Formatter** — Add Prettier with consistent config (single quotes, semicolons, 2-space indent).
3. **Pre-commit hooks** — Use `husky` + `lint-staged` to run lint/format on commit.
4. **EditorConfig** — Add `.editorconfig` for consistent formatting across editors.

## Testing

1. **Test framework** — Use Jest (with `ts-jest`) or Vitest. Configure in `package.json` or dedicated config file.
2. **Test structure** — Mirror `src/` in `tests/`. Name files `*.test.ts` or `*.spec.ts`.
3. **Coverage** — Configure coverage reporting. Aim for 80%+ on critical paths.
4. **Scripts** — Add `npm test`, `npm run test:watch`, `npm run test:coverage`.

## Dependencies

1. **Pin versions** — Use exact versions or lockfiles for reproducibility.
2. **Separate dev dependencies** — `devDependencies` for tools, `dependencies` for runtime.
3. **Minimize dependencies** — Prefer built-in Node.js APIs (fs, path, crypto, http) over trivial packages.
4. **Audit regularly** — Run `npm audit` to check for vulnerabilities.

## Environment & Configuration

1. **Use `.env` files** — with `dotenv` or framework-native support. Never commit secrets.
2. **Provide `.env.example`** — document all required environment variables with descriptions.
3. **Validate config at startup** — fail fast if required variables are missing.

## Scripts (package.json)

Always include these npm scripts:
```json
{
  "dev": "tsx src/index.ts",
  "build": "tsc",
  "start": "node dist/index.js",
  "test": "jest",
  "test:watch": "jest --watch",
  "test:coverage": "jest --coverage",
  "lint": "eslint src/",
  "lint:fix": "eslint src/ --fix",
  "typecheck": "tsc --noEmit",
  "validate": "npm run lint && npm run typecheck && npm test"
}
```

## Security

1. **Never hardcode secrets** — use environment variables.
2. **Validate all user input** — at system boundaries (API endpoints, CLI args).
3. **Use parameterized queries** — never concatenate SQL strings.
4. **Set security headers** — `helmet` for Express, built-in for Fastify.
5. **CORS** — configure explicitly, never use `*` in production.

## Commit Conventions

Use Conventional Commits:
- `feat(scope): description` — new feature
- `fix(scope): description` — bug fix
- `docs: description` — documentation
- `test: description` — adding tests
- `refactor: description` — code restructure
- `chore: description` — tooling, deps, config
