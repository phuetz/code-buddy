---
name: coding-agent
version: 1.0.0
description: Best practices for autonomous coding tasks. Use when performing complex multi-file changes, refactoring, or building features from scratch.
author: Code Buddy
tags: coding, agent, autonomous, development, refactor
---

# Coding Agent

## Overview

Guidelines for performing autonomous coding tasks effectively and safely.

## Before Coding

### 1. Understand the codebase
- Read `package.json` / `pyproject.toml` / `Cargo.toml` for project context
- Read `README.md` and any `CLAUDE.md` / `AGENTS.md`
- Identify the tech stack, patterns, and conventions in use
- Check existing tests to understand expected behavior

### 2. Plan before writing
- For non-trivial changes, outline the approach first
- Identify which files need to change
- Consider edge cases and error handling
- Check if similar patterns already exist in the codebase

### 3. Check the current state
```bash
git status        # Uncommitted changes?
git branch        # Which branch?
npm test          # Tests passing?
```

## During Coding

### Safety Rules
1. **Never delete files** without confirming with the user
2. **Stage specific files** — never `git add -A` or `git add .`
3. **Run tests after changes** — verify nothing is broken
4. **Commit frequently** — small, focused commits are better
5. **Don't modify unrelated code** — stay focused on the task

### Code Quality
1. **Follow existing conventions** — match the project's style
2. **Type safety** — avoid `any`, use proper types
3. **Error handling** — handle failures at system boundaries
4. **No dead code** — remove unused imports, variables, functions
5. **Minimal changes** — don't refactor code you weren't asked to change

### Multi-File Changes
1. Start with types/interfaces
2. Then implement core logic
3. Then update call sites
4. Then update tests
5. Finally update docs if needed

## After Coding

### Verification Checklist
```bash
npx tsc --noEmit          # TypeScript compiles
npm run lint               # No lint errors
npm test                   # All tests pass
git diff --stat            # Review changes
```

### Commit
- Use Conventional Commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`
- One logical change per commit
- Descriptive message explaining WHY, not just WHAT

## Parallel Workflows

For multiple independent tasks, use git worktrees:
```bash
git worktree add ../project-fix-auth fix/auth-bug
git worktree add ../project-add-search feat/search
# Work in each directory independently
git worktree remove ../project-fix-auth  # Clean up after merge
```

## Recovery

If something goes wrong:
```bash
git stash                  # Save current changes
git checkout .             # Discard all changes (careful!)
git stash pop              # Restore saved changes
```
