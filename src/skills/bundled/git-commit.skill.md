---
name: git-commit
description: Create a git commit with a well-formatted message
version: 1.0.0
author: Code Buddy
tags:
  - git
  - commit
  - vcs
requires:
  tools:
    - bash
nativeEngine:
  category: development
  priority: 85
  triggers:
    - make a commit
    - git commit
    - create commit
    - save changes
  examples:
    - "Commit my changes"
    - "Create a commit with message 'fix bug'"
---

# Git Commit

Create a git commit following conventional commit format.

## When to Use

- User wants to commit their changes
- User asks to save changes to git
- User wants to create a commit with a message

## Examples

- Commit my changes
  > Creates a commit with auto-generated message based on changes
- Create a commit with message "fix login bug"
  > Creates a commit with the specified message

## Steps

1. Run `git status` to see changed files
2. Run `git diff --staged` to see what will be committed
3. If no files staged, suggest running `git add`
4. Generate or use provided commit message in conventional format
5. Run `git commit -m "message"`
6. Show confirmation with commit hash

## Tools

- `bash(git status)`: Check repository status
- `bash(git diff --staged)`: View staged changes
- `bash(git commit -m "message")`: Create the commit

## Commit Message Format

Use conventional commits format:
- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation
- `refactor:` Code refactoring
- `test:` Adding tests
- `chore:` Maintenance
