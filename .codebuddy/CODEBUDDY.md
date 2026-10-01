# Custom Instructions for Code Buddy

## About This Project
Source-available multi-provider AI coding agent for the terminal. Supports Grok, Claude, ChatGPT, Gemini, Ollama and LM Studio with repository tools, multi-channel messaging, skills system, and OpenClaw-inspired architecture.

- **Languages:** TypeScript, JavaScript
- **Framework:** Ink (terminal UI)
- **Module system:** ESM
- **Package manager:** npm
- **Test framework:** Vitest

## Code Style Guidelines
- Use TypeScript for all new files
- Avoid `any`; use proper types
- Follow the existing code style
- ESM imports require `.js` extension even for `.ts` files

## Architecture
- `src/` — Source code
- `tests/` — Test files
- `docs/` — Documentation

**Entry point:** `dist/index.js`

## Testing
- Write tests for new features (Vitest)
- Run: `npm run test`

## Commands
- Build: `npm run build`
- Lint: `npm run lint`
- Typecheck: `npm run typecheck`
- Validate: `npm run validate`
- Format: `npm run format`

## Git Conventions
- Use conventional commits (feat:, fix:, docs:, etc.)
- Keep commits small and focused
- Write descriptive commit messages

## Reference

> This project has a `CLAUDE.md` with detailed instructions. Refer to it for architecture details, testing gotchas, and subsystem reference.

## Forbidden Actions
- Never commit .env files
- Never expose API keys
- Never delete production data
